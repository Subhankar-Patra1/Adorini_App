import {
  IllegalOrderTransitionError,
  assertTransition,
  canTransition,
  isTerminalStatus,
  statusAfterSuccessfulPayment,
} from './order-state-machine';
import { OrderStatus, PaymentMethod } from '../../../common/enums/domain.enums';

describe('order state machine', () => {
  describe('legal transitions', () => {
    it.each([
      [OrderStatus.ORDERED, OrderStatus.PENDING_VERIFICATION],
      [OrderStatus.ORDERED, OrderStatus.CONFIRMED],
      [OrderStatus.ORDERED, OrderStatus.CANCELLED],
      [OrderStatus.PENDING_VERIFICATION, OrderStatus.CONFIRMED],
      [OrderStatus.PENDING_VERIFICATION, OrderStatus.CANCELLED],
      [OrderStatus.CONFIRMED, OrderStatus.SHIPPED],
      [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
      [OrderStatus.SHIPPED, OrderStatus.DELIVERED],
      [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
    ])('allows %s -> %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to, 'order-1')).not.toThrow();
    });
  });

  describe('illegal transitions are rejected, not ignored', () => {
    it.each([
      // Skipping dispatch entirely.
      [OrderStatus.ORDERED, OrderStatus.SHIPPED],
      [OrderStatus.ORDERED, OrderStatus.DELIVERED],
      [OrderStatus.CONFIRMED, OrderStatus.DELIVERED],
      // Going backwards.
      [OrderStatus.SHIPPED, OrderStatus.CONFIRMED],
      [OrderStatus.CONFIRMED, OrderStatus.ORDERED],
      // Resurrecting a terminal order — the referral-payout hazard.
      [OrderStatus.DELIVERED, OrderStatus.SHIPPED],
      [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      [OrderStatus.CANCELLED, OrderStatus.CONFIRMED],
      [OrderStatus.CANCELLED, OrderStatus.DELIVERED],
    ])('rejects %s -> %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to, 'order-1')).toThrow(IllegalOrderTransitionError);
    });

    it('names both states and the order in the error', () => {
      expect(() => assertTransition(OrderStatus.DELIVERED, OrderStatus.SHIPPED, 'order-9')).toThrow(
        /order-9 cannot move from DELIVERED to SHIPPED/,
      );
    });
  });

  describe('terminal statuses', () => {
    it.each([OrderStatus.DELIVERED, OrderStatus.CANCELLED])('treats %s as terminal', (status) => {
      expect(isTerminalStatus(status)).toBe(true);
    });

    it.each([
      OrderStatus.ORDERED,
      OrderStatus.PENDING_VERIFICATION,
      OrderStatus.CONFIRMED,
      OrderStatus.SHIPPED,
    ])('treats %s as non-terminal', (status) => {
      expect(isTerminalStatus(status)).toBe(false);
    });
  });

  describe('statusAfterSuccessfulPayment', () => {
    it('routes COD through intent verification rather than straight to confirmed', () => {
      expect(statusAfterSuccessfulPayment(PaymentMethod.COD)).toBe(
        OrderStatus.PENDING_VERIFICATION,
      );
    });

    it.each([PaymentMethod.UPI, PaymentMethod.CARD])('confirms prepaid method %s', (method) => {
      expect(statusAfterSuccessfulPayment(method)).toBe(OrderStatus.CONFIRMED);
    });
  });
});
