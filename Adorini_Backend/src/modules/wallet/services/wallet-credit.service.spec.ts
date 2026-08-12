import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { WalletCreditService } from './wallet-credit.service';
import { ReferralStatus, WalletTransactionType } from '../../../common/enums/domain.enums';
import { Referral } from '../../../database/entities/referral.entity';
import { Wallet } from '../../../database/entities/wallet.entity';
import { WalletTransaction } from '../../../database/entities/wallet-transaction.entity';

describe('WalletCreditService', () => {
  let service: WalletCreditService;
  let manager: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };

  const referral = (overrides: Partial<Referral> = {}): Referral =>
    ({
      id: 'ref-1',
      referrerId: 'user-referrer',
      status: ReferralStatus.PENDING,
      creditPaise: 10_000,
      qualifyingOrderId: 'order-1',
      creditedAt: null,
      ...overrides,
    }) as Referral;

  beforeEach(async () => {
    manager = {
      findOne: jest.fn(),
      save: jest.fn((_entity: unknown, value: unknown) => value),
      create: jest.fn((_entity: unknown, value: unknown) => value),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletCreditService],
    }).compile();

    service = module.get(WalletCreditService);
  });

  it('does nothing when the delivered order has no referral attached', async () => {
    manager.findOne.mockResolvedValue(null);

    const result = await service.creditReferralForDeliveredOrder(manager as never, 'order-1');

    expect(result).toEqual({ outcome: 'no_referral' });
    expect(manager.save).not.toHaveBeenCalled();
  });

  describe('resolving which referral a delivery settles', () => {
    /**
     * Nothing currently writes `Referral.qualifyingOrderId` — signup records the
     * referral before any order exists, and order placement lives in `checkout`,
     * which is not built yet. Without the fallback below every payout would
     * silently find nothing: the feature would look finished and pay no one.
     */
    it('falls back to the referee’s outstanding referral when no order link exists', async () => {
      manager.findOne
        .mockResolvedValueOnce(null) // no qualifyingOrderId link
        .mockResolvedValueOnce({ id: 'order-1', userId: 'user-referee' }) // the order
        .mockResolvedValueOnce(referral({ qualifyingOrderId: null })) // by referee
        .mockResolvedValueOnce({ id: 'wallet-1', userId: 'user-referrer', balancePaise: 0 });

      const result = await service.creditReferralForDeliveredOrder(manager as never, 'order-1');

      expect(result).toMatchObject({ outcome: 'credited', creditPaise: 10_000 });
    });

    it('only considers a PENDING referral for that referee', async () => {
      // Once paid the referral is CREDITED, so a later delivery by the same
      // buyer must not pay again.
      manager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'order-1', userId: 'user-referee' })
        .mockResolvedValueOnce(null);

      await service.creditReferralForDeliveredOrder(manager as never, 'order-1');

      expect(manager.findOne).toHaveBeenLastCalledWith(Referral, {
        where: { refereeId: 'user-referee', status: ReferralStatus.PENDING },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('records which order qualified when resolved by fallback', async () => {
      const found = referral({ qualifyingOrderId: null });
      manager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'order-9', userId: 'user-referee' })
        .mockResolvedValueOnce(found)
        .mockResolvedValueOnce({ id: 'wallet-1', userId: 'user-referrer', balancePaise: 0 });

      await service.creditReferralForDeliveredOrder(manager as never, 'order-9');

      expect(found.qualifyingOrderId).toBe('order-9');
    });

    it('prefers an explicit order link when one exists', async () => {
      manager.findOne
        .mockResolvedValueOnce(referral())
        .mockResolvedValueOnce({ id: 'wallet-1', userId: 'user-referrer', balancePaise: 0 });

      await service.creditReferralForDeliveredOrder(manager as never, 'order-1');

      // Only the link lookup and the wallet lookup — no order round trip.
      expect(manager.findOne).toHaveBeenCalledTimes(2);
    });

    it('gives up quietly when the order itself is gone', async () => {
      manager.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await expect(
        service.creditReferralForDeliveredOrder(manager as never, 'order-1'),
      ).resolves.toEqual({ outcome: 'no_referral' });
    });
  });

  it.each([ReferralStatus.CREDITED, ReferralStatus.VOID])(
    'declines to pay a referral already marked %s',
    async (status) => {
      manager.findOne.mockResolvedValue(referral({ status }));

      const result = await service.creditReferralForDeliveredOrder(manager as never, 'order-1');

      expect(result).toEqual({ outcome: 'already_settled', referralId: 'ref-1' });
      expect(manager.save).not.toHaveBeenCalled();
    },
  );

  it('voids a referral whose referrer account is gone', async () => {
    manager.findOne.mockResolvedValue(referral({ referrerId: null }));

    const result = await service.creditReferralForDeliveredOrder(manager as never, 'order-1');

    expect(result).toEqual({ outcome: 'voided', referralId: 'ref-1' });
    expect(manager.save).toHaveBeenCalledWith(
      Referral,
      expect.objectContaining({ status: ReferralStatus.VOID }),
    );
  });

  it('locks the referral row for update', async () => {
    manager.findOne.mockResolvedValue(null);

    await service.creditReferralForDeliveredOrder(manager as never, 'order-1');

    expect(manager.findOne).toHaveBeenCalledWith(Referral, {
      where: { qualifyingOrderId: 'order-1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('credits an existing wallet, writes a ledger row, and marks the referral credited', async () => {
    manager.findOne
      .mockResolvedValueOnce(referral())
      .mockResolvedValueOnce({ id: 'wallet-1', userId: 'user-referrer', balancePaise: 5_000 });

    const result = await service.creditReferralForDeliveredOrder(manager as never, 'order-1');

    expect(result).toEqual({ outcome: 'credited', referralId: 'ref-1', creditPaise: 10_000 });

    expect(manager.save).toHaveBeenCalledWith(
      Wallet,
      expect.objectContaining({ id: 'wallet-1', balancePaise: 15_000 }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      WalletTransaction,
      expect.objectContaining({
        walletId: 'wallet-1',
        type: WalletTransactionType.REFERRAL_CREDIT,
        amountPaise: 10_000,
        balanceAfterPaise: 15_000,
        referenceId: 'ref-1',
      }),
    );
    const saveCalls = manager.save.mock.calls as [unknown, Referral][];
    const savedReferral = saveCalls.find((call) => call[0] === Referral)?.[1];

    expect(savedReferral?.status).toBe(ReferralStatus.CREDITED);
    expect(savedReferral?.creditedAt).toBeInstanceOf(Date);
  });

  it('mints a wallet on first credit when the referrer has none', async () => {
    manager.findOne.mockResolvedValueOnce(referral()).mockResolvedValueOnce(null);
    manager.save.mockImplementation((entity: unknown, value: Record<string, unknown>) =>
      entity === Wallet && !value.id ? { ...value, id: 'wallet-new' } : value,
    );

    const result = await service.creditReferralForDeliveredOrder(manager as never, 'order-1');

    expect(result).toEqual({ outcome: 'credited', referralId: 'ref-1', creditPaise: 10_000 });
    expect(manager.save).toHaveBeenCalledWith(
      WalletTransaction,
      expect.objectContaining({ walletId: 'wallet-new', balanceAfterPaise: 10_000 }),
    );
  });

  it('locks the wallet row so concurrent credits serialise', async () => {
    manager.findOne
      .mockResolvedValueOnce(referral())
      .mockResolvedValueOnce({ id: 'wallet-1', userId: 'user-referrer', balancePaise: 0 });

    await service.creditReferralForDeliveredOrder(manager as never, 'order-1');

    expect(manager.findOne).toHaveBeenCalledWith(Wallet, {
      where: { userId: 'user-referrer' },
      lock: { mode: 'pessimistic_write' },
    });
  });
});
