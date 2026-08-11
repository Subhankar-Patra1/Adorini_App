import type { DataSource } from 'typeorm';

import { ProcessedWebhook, Referral, User, Wallet, WalletTransaction } from './entities';
import { initTestDataSource, truncateAll } from './testing/test-data-source';
import {
  ReferralStatus,
  WalletTransactionType,
  WebhookProvider,
} from '../common/enums/domain.enums';

/**
 * Proves the @GUARD mitigations that Phase 2 is responsible for, against a real
 * PostgreSQL instance.
 *
 * These are deliberately database-level tests. The mitigations are database
 * constraints precisely so that no service-layer bug or future refactor can
 * bypass them — asserting them through a mocked repository would test the mock.
 *
 * Each test here fails if its constraint is dropped from the migration, which
 * is the ROADMAP's stated bar for a mitigation test.
 */
describe('@GUARD mitigations (Phase 2 — data model)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await initTestDataSource();
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.destroy();
    }
  });

  beforeEach(async () => {
    await truncateAll(ds);
  });

  describe('Risk #1 (CRITICAL) — webhook idempotency', () => {
    const eventId = 'evt_cashfree_1234567890';

    it('rejects a replay of the same provider + event id', async () => {
      const repo = ds.getRepository(ProcessedWebhook);

      await repo.insert({
        webhookProvider: WebhookProvider.CASHFREE,
        webhookEventId: eventId,
        eventType: 'PAYMENT_SUCCESS_WEBHOOK',
      });

      // Cashfree retries on any non-2xx or timeout, so this is routine traffic,
      // not an attack. The second insert must not be allowed to land.
      await expect(
        repo.insert({
          webhookProvider: WebhookProvider.CASHFREE,
          webhookEventId: eventId,
          eventType: 'PAYMENT_SUCCESS_WEBHOOK',
        }),
      ).rejects.toThrow(/uq_processed_webhook_provider_event|duplicate key/i);

      await expect(repo.count()).resolves.toBe(1);
    });

    it('scopes uniqueness per provider, so ids from different providers coexist', async () => {
      const repo = ds.getRepository(ProcessedWebhook);

      // Providers mint ids independently; a global unique index on event id
      // alone would silently drop a Delhivery event that happened to collide
      // with a Cashfree one.
      await repo.insert({
        webhookProvider: WebhookProvider.CASHFREE,
        webhookEventId: 'shared-id-1',
      });
      await repo.insert({
        webhookProvider: WebhookProvider.DELHIVERY,
        webhookEventId: 'shared-id-1',
      });
      await repo.insert({
        webhookProvider: WebhookProvider.MSG91,
        webhookEventId: 'shared-id-1',
      });

      await expect(repo.count()).resolves.toBe(3);
    });

    it('credits a referral exactly once when the delivery event is replayed', async () => {
      // This is the money-losing scenario the constraint exists to prevent:
      // Delhivery redelivers a DELIVERED event and the buyer's referrer gets
      // paid ₹100 twice.
      const user = await ds.getRepository(User).save({
        phone: '919876500001',
        isPhoneVerified: true,
      });
      const wallet = await ds.getRepository(Wallet).save({
        userId: user.id,
        balancePaise: 0,
      });

      const deliveryEventId = 'evt_delhivery_delivered_555';
      const creditPaise = 10_000;

      /**
       * Mirrors the Phase 4 handler shape: the side effect and the idempotency
       * row are written in ONE transaction. If the marker insert violates the
       * unique constraint, the whole transaction rolls back and the credit
       * never happened.
       */
      const applyDeliveryEvent = async (): Promise<'applied' | 'duplicate'> => {
        try {
          await ds.transaction(async (manager) => {
            await manager.insert(ProcessedWebhook, {
              webhookProvider: WebhookProvider.DELHIVERY,
              webhookEventId: deliveryEventId,
              eventType: 'DELIVERED',
            });

            await manager.increment(Wallet, { id: wallet.id }, 'balancePaise', creditPaise);
            await manager.insert(WalletTransaction, {
              walletId: wallet.id,
              type: WalletTransactionType.REFERRAL_CREDIT,
              amountPaise: creditPaise,
              balanceAfterPaise: creditPaise,
            });
          });
          return 'applied';
        } catch {
          return 'duplicate';
        }
      };

      expect(await applyDeliveryEvent()).toBe('applied');
      expect(await applyDeliveryEvent()).toBe('duplicate');
      expect(await applyDeliveryEvent()).toBe('duplicate');

      const finalWallet = await ds.getRepository(Wallet).findOneByOrFail({ id: wallet.id });
      const ledgerEntries = await ds
        .getRepository(WalletTransaction)
        .countBy({ walletId: wallet.id });

      // Three deliveries of the same event, one ₹100 credit, one ledger row.
      expect(finalWallet.balancePaise).toBe(creditPaise);
      expect(ledgerEntries).toBe(1);
    });
  });

  describe('Risk #4 (MEDIUM) — catalog filter indexes', () => {
    it('has the three indexes the filter rail depends on', async () => {
      const rows: { indexname: string }[] = await ds.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'products'`,
      );
      const names = rows.map((r) => r.indexname);

      expect(names).toEqual(
        expect.arrayContaining([
          'idx_products_category_price',
          'idx_products_brand',
          'idx_products_fabric_type',
        ]),
      );
    });

    it('the planner can serve a category + price-range filter from the index', async () => {
      // Existence alone is not the property that matters — an index the planner
      // cannot use for the actual query shape is dead weight. The seed dataset
      // is far too small for the planner to prefer an index scan on cost, so
      // sequential scans are disabled to ask "is this index usable here?"
      await ds.query('SET LOCAL enable_seqscan = off');

      const plan: { 'QUERY PLAN': string }[] = await ds.query(
        `EXPLAIN SELECT id FROM products
         WHERE category_id = '00000000-0000-0000-0000-000000000000'
           AND price_paise BETWEEN 30000 AND 150000`,
      );
      const planText = plan.map((r) => r['QUERY PLAN']).join('\n');

      expect(planText).toContain('idx_products_category_price');
    });
  });

  describe('Risk #6 (LOW) — referral abuse', () => {
    async function createUser(phone: string): Promise<User> {
      return ds.getRepository(User).save({ phone, isPhoneVerified: true });
    }

    it('rejects a user referring themselves', async () => {
      const user = await createUser('919876500010');

      await expect(
        ds.getRepository(Referral).insert({
          referrerId: user.id,
          refereeId: user.id,
          refereePhone: user.phone,
          status: ReferralStatus.PENDING,
          creditPaise: 10_000,
        }),
      ).rejects.toThrow(/chk_referral_no_self_referral/i);
    });

    it('rejects a second referral of the same phone number', async () => {
      const referrerA = await createUser('919876500020');
      const referrerB = await createUser('919876500021');
      const refereeFirst = await createUser('919876500022');

      const repo = ds.getRepository(Referral);
      await repo.insert({
        referrerId: referrerA.id,
        refereeId: refereeFirst.id,
        refereePhone: '919876500022',
        status: ReferralStatus.PENDING,
        creditPaise: 10_000,
      });

      // The attack: delete the account, sign up again on the same number, and
      // collect a second ₹100. Uniqueness is on the phone, not the user row,
      // precisely so recreating the user does not reset eligibility.
      await ds.getRepository(User).delete({ id: refereeFirst.id });
      const refereeAgain = await createUser('919876500022');

      await expect(
        repo.insert({
          referrerId: referrerB.id,
          refereeId: refereeAgain.id,
          refereePhone: '919876500022',
          status: ReferralStatus.PENDING,
          creditPaise: 10_000,
        }),
      ).rejects.toThrow(/uq_referral_referee_phone|duplicate key/i);
    });

    it('allows one referrer to refer many distinct people', async () => {
      const referrer = await createUser('919876500030');
      const repo = ds.getRepository(Referral);

      for (let i = 0; i < 3; i++) {
        const referee = await createUser(`91987650004${i}`);
        await repo.insert({
          referrerId: referrer.id,
          refereeId: referee.id,
          refereePhone: referee.phone,
          status: ReferralStatus.PENDING,
          creditPaise: 10_000,
        });
      }

      await expect(repo.countBy({ referrerId: referrer.id })).resolves.toBe(3);
    });
  });
});
