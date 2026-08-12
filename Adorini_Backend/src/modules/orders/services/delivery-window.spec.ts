import {
  deliveryResponseDeadline,
  describeRetryOffer,
  isResponseWindowExpired,
} from './delivery-window';
import { OrderStatus } from '../../../common/enums/domain.enums';

describe('delivery-window', () => {
  const RULES = { maxAttempts: 3, responseWindowHours: 24 };

  afterEach(() => {
    jest.useRealTimers();
  });

  function freezeAt(iso: string): void {
    jest.useFakeTimers().setSystemTime(new Date(iso));
  }

  describe('deliveryResponseDeadline', () => {
    it('adds the window to the failure time, not to now', () => {
      // The deadline must not move just because the prompt went out late.
      freezeAt('2026-08-14T00:00:00.000Z');

      const deadline = deliveryResponseDeadline(new Date('2026-08-12T10:00:00.000Z'), 24);

      expect(deadline?.toISOString()).toBe('2026-08-13T10:00:00.000Z');
    });

    it('is null when no attempt has failed', () => {
      expect(deliveryResponseDeadline(null, 24)).toBeNull();
    });
  });

  describe('isResponseWindowExpired', () => {
    it('is open inside the window', () => {
      freezeAt('2026-08-12T20:00:00.000Z');

      expect(isResponseWindowExpired(new Date('2026-08-12T10:00:00.000Z'), 24)).toBe(false);
    });

    it('is expired past the window', () => {
      freezeAt('2026-08-13T11:00:00.000Z');

      expect(isResponseWindowExpired(new Date('2026-08-12T10:00:00.000Z'), 24)).toBe(true);
    });

    it('treats a missing failure time as expired', () => {
      // We cannot prove the window is open, and this gates a decision that
      // moves stock — refusing is the safe direction.
      expect(isResponseWindowExpired(null, 24)).toBe(true);
    });

    it('gives an 8pm failure a full day, not four hours', () => {
      // The whole reason the window is measured in hours from the attempt
      // rather than to midnight.
      freezeAt('2026-08-13T09:00:00.000Z');

      expect(isResponseWindowExpired(new Date('2026-08-12T20:00:00.000Z'), 24)).toBe(false);
    });
  });

  describe('describeRetryOffer', () => {
    const failedAt = new Date('2026-08-12T10:00:00.000Z');

    it('offers a retry on a failed delivery inside the window with attempts left', () => {
      freezeAt('2026-08-12T12:00:00.000Z');

      const offer = describeRetryOffer({
        status: OrderStatus.DELIVERY_FAILED,
        deliveryAttempts: 1,
        lastDeliveryFailedAt: failedAt,
        ...RULES,
      });

      expect(offer).toEqual({
        canRequestReattempt: true,
        respondByIso: '2026-08-13T10:00:00.000Z',
        attemptsRemaining: 2,
      });
    });

    it('withholds the offer once the window has closed', () => {
      freezeAt('2026-08-14T00:00:00.000Z');

      const offer = describeRetryOffer({
        status: OrderStatus.DELIVERY_FAILED,
        deliveryAttempts: 1,
        lastDeliveryFailedAt: failedAt,
        ...RULES,
      });

      expect(offer.canRequestReattempt).toBe(false);
      // Still reported, so the app can explain *why* rather than just hiding a button.
      expect(offer.attemptsRemaining).toBe(2);
    });

    it('withholds the offer when the courier will not try again', () => {
      freezeAt('2026-08-12T12:00:00.000Z');

      const offer = describeRetryOffer({
        status: OrderStatus.DELIVERY_FAILED,
        deliveryAttempts: 3,
        lastDeliveryFailedAt: failedAt,
        ...RULES,
      });

      expect(offer.canRequestReattempt).toBe(false);
      expect(offer.attemptsRemaining).toBe(0);
    });

    it('never reports negative attempts remaining', () => {
      const offer = describeRetryOffer({
        status: OrderStatus.DELIVERY_FAILED,
        deliveryAttempts: 5,
        lastDeliveryFailedAt: failedAt,
        ...RULES,
      });

      expect(offer.attemptsRemaining).toBe(0);
    });

    it.each([
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.CONFIRMED,
    ])('offers nothing for an order in %s', (status) => {
      freezeAt('2026-08-12T12:00:00.000Z');

      const offer = describeRetryOffer({
        status,
        deliveryAttempts: 1,
        lastDeliveryFailedAt: failedAt,
        ...RULES,
      });

      expect(offer.canRequestReattempt).toBe(false);
    });
  });
});
