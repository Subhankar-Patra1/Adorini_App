import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { PricingService } from './pricing.service';

describe('PricingService', () => {
  let service: PricingService;

  const config: Record<string, number> = {
    FREE_DELIVERY_THRESHOLD_PAISE: 300_000, // ₹3,000
    DELIVERY_FEE_PAISE: 4_900, // ₹49
    FIRST_ORDER_DISCOUNT_PERCENT: 10,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => config[k]) } },
      ],
    }).compile();

    service = module.get(PricingService);
  });

  const line = (unitPricePaise: number, quantity = 1) => ({ unitPricePaise, quantity });

  describe('subtotal', () => {
    it('multiplies unit price by quantity across lines', () => {
      const totals = service.calculate({
        lines: [line(89_900, 2), line(74_900)],
        isFirstOrder: false,
      });

      expect(totals.subtotalPaise).toBe(89_900 * 2 + 74_900);
    });

    it('is zero for an empty cart', () => {
      expect(service.calculate({ lines: [], isFirstOrder: false }).subtotalPaise).toBe(0);
    });

    it('stays an exact integer — no float dust', () => {
      // Every amount is paise precisely so ₹1,299.50 is 129950 and cannot drift.
      const totals = service.calculate({
        lines: [line(129_950, 3), line(32_900, 7)],
        isFirstOrder: false,
      });

      expect(Number.isInteger(totals.subtotalPaise)).toBe(true);
      expect(totals.subtotalPaise).toBe(129_950 * 3 + 32_900 * 7);
    });
  });

  describe('first-order discount', () => {
    it('applies the configured percentage', () => {
      const totals = service.calculate({ lines: [line(100_000)], isFirstOrder: true });

      expect(totals.discountPaise).toBe(10_000);
    });

    it('is withheld from repeat buyers', () => {
      expect(service.calculate({ lines: [line(100_000)], isFirstOrder: false }).discountPaise).toBe(
        0,
      );
    });

    it('rounds down, never up', () => {
      // 10% of 99999 is 9999.9 — rounding up would hand out a paisa we never
      // charged, and across a catalogue that is a slow leak.
      const totals = service.calculate({ lines: [line(99_999)], isFirstOrder: true });

      expect(totals.discountPaise).toBe(9_999);
    });
  });

  describe('free delivery', () => {
    it('charges the fee below the threshold', () => {
      const totals = service.calculate({ lines: [line(299_999)], isFirstOrder: false });

      expect(totals.deliveryFeePaise).toBe(4_900);
      expect(totals.qualifiesForFreeDelivery).toBe(false);
      expect(totals.freeDeliveryShortfallPaise).toBe(1);
    });

    it('waives it exactly at the threshold', () => {
      const totals = service.calculate({ lines: [line(300_000)], isFirstOrder: false });

      expect(totals.deliveryFeePaise).toBe(0);
      expect(totals.qualifiesForFreeDelivery).toBe(true);
      expect(totals.freeDeliveryShortfallPaise).toBe(0);
    });

    it('measures the threshold before the discount, not after', () => {
      // A buyer told "free delivery unlocked" must not have it taken away by
      // their own first-order discount pushing the figure back under the bar.
      const totals = service.calculate({ lines: [line(300_000)], isFirstOrder: true });

      expect(totals.discountPaise).toBe(30_000); // drops payable to 270,000
      expect(totals.deliveryFeePaise).toBe(0); // still free
    });
  });

  describe('wallet credit', () => {
    it('applies what was asked for when it is available', () => {
      const totals = service.calculate({
        lines: [line(100_000)],
        isFirstOrder: false,
        requestedWalletCreditPaise: 10_000,
        availableWalletCreditPaise: 50_000,
      });

      expect(totals.walletCreditPaise).toBe(10_000);
      expect(totals.totalPaise).toBe(100_000 + 4_900 - 10_000);
    });

    it('clamps to the actual balance', () => {
      // The request is a client-supplied number; the balance is ours.
      const totals = service.calculate({
        lines: [line(100_000)],
        isFirstOrder: false,
        requestedWalletCreditPaise: 999_999,
        availableWalletCreditPaise: 7_500,
      });

      expect(totals.walletCreditPaise).toBe(7_500);
    });

    it('never exceeds what is actually owed', () => {
      // Otherwise a large balance on a small order yields a negative total,
      // which chk_order_amounts_non_negative would reject at the very end of
      // checkout — after stock had already been taken.
      const totals = service.calculate({
        lines: [line(10_000)],
        isFirstOrder: false,
        requestedWalletCreditPaise: 500_000,
        availableWalletCreditPaise: 500_000,
      });

      expect(totals.walletCreditPaise).toBe(10_000 + 4_900);
      expect(totals.totalPaise).toBe(0);
    });

    it('ignores a negative request', () => {
      const totals = service.calculate({
        lines: [line(100_000)],
        isFirstOrder: false,
        requestedWalletCreditPaise: -50_000,
        availableWalletCreditPaise: 50_000,
      });

      expect(totals.walletCreditPaise).toBe(0);
    });

    it('applies nothing when the wallet is empty', () => {
      expect(
        service.calculate({
          lines: [line(100_000)],
          isFirstOrder: false,
          requestedWalletCreditPaise: 10_000,
        }).walletCreditPaise,
      ).toBe(0);
    });
  });

  describe('the total always satisfies the database constraint', () => {
    /**
     * `chk_order_totals_consistent` enforces
     * `total = subtotal - discount + delivery - walletCredit`.
     * If this arithmetic ever disagreed, checkout would fail at the very last
     * INSERT with a constraint violation rather than a useful error.
     */
    it.each([
      [[line(89_900, 2)], true, 0, 0],
      [[line(350_000)], false, 0, 0],
      [[line(50_000, 3)], true, 20_000, 100_000],
      [[line(10_000)], false, 999_999, 999_999],
      [[], false, 0, 0],
    ])('holds for case %#', (lines, isFirstOrder, requested, available) => {
      const t = service.calculate({
        lines,
        isFirstOrder,
        requestedWalletCreditPaise: requested,
        availableWalletCreditPaise: available,
      });

      expect(t.totalPaise).toBe(
        t.subtotalPaise - t.discountPaise + t.deliveryFeePaise - t.walletCreditPaise,
      );
      // The other constraint: nothing may be negative.
      expect(t.totalPaise).toBeGreaterThanOrEqual(0);
      expect(t.discountPaise).toBeGreaterThanOrEqual(0);
      expect(t.walletCreditPaise).toBeGreaterThanOrEqual(0);
    });
  });
});
