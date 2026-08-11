/**
 * Domain enums shared by entities, DTOs, and services.
 *
 * These are persisted as native PostgreSQL enum types, so the database rejects
 * an out-of-range value even if a bug bypasses Zod at the boundary. Renaming a
 * member is therefore a migration, not just a code change.
 */

/**
 * Order lifecycle. `PENDING_VERIFICATION` only occurs on COD orders, which must
 * pass an MSG91 OTP intent check before dispatch. Transition enforcement lives
 * in the orders module (Phase 4); this enum only fixes the vocabulary.
 */
export enum OrderStatus {
  ORDERED = 'ORDERED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  CONFIRMED = 'CONFIRMED',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
  COD = 'COD',
  UPI = 'UPI',
  CARD = 'CARD',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

/**
 * Drives which size chart the PDP renders. A stretch fabric tolerates a wider
 * body-measurement range per nominal size than a rigid one, so the same
 * nominal size 42 means different things across these two — this is the core
 * of the returns-reduction bet.
 */
export enum FabricType {
  STRETCH = 'STRETCH',
  RIGID = 'RIGID',
}

/** Traditional prints/techniques used as catalog filter chips. */
export enum PrintTechnique {
  KALANKARI = 'KALANKARI',
  AJRAK = 'AJRAK',
  BATIK = 'BATIK',
  APLIK = 'APLIK',
  FANCY = 'FANCY',
}

/**
 * Who supplied a media asset. Admin-curated media earns the "Official Media"
 * badge; buyer-submitted review photos never do. Conflating the two would
 * destroy the trust signal the product is built around.
 */
export enum MediaProvenance {
  ADMIN = 'ADMIN',
  BUYER = 'BUYER',
}

export enum MediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

/** Structured fit feedback — the raw signal behind size-chart corrections. */
export enum FitTag {
  RUNS_SMALL = 'RUNS_SMALL',
  TRUE_TO_SIZE = 'TRUE_TO_SIZE',
  RUNS_LARGE = 'RUNS_LARGE',
}

export enum SizeEnquiryStatus {
  OPEN = 'OPEN',
  RESPONDED = 'RESPONDED',
  CLOSED = 'CLOSED',
}

/** External systems that call in via webhooks (see @GUARD Risk #1). */
export enum WebhookProvider {
  CASHFREE = 'CASHFREE',
  DELHIVERY = 'DELHIVERY',
  MSG91 = 'MSG91',
}

export enum WalletTransactionType {
  REFERRAL_CREDIT = 'REFERRAL_CREDIT',
  ORDER_DEBIT = 'ORDER_DEBIT',
  REFUND_CREDIT = 'REFUND_CREDIT',
  ADMIN_ADJUSTMENT = 'ADMIN_ADJUSTMENT',
}

/**
 * A referral is only `CREDITED` once the referee's order reaches `DELIVERED` —
 * crediting at order placement would pay out on COD orders that are later
 * refused at the door.
 */
export enum ReferralStatus {
  PENDING = 'PENDING',
  CREDITED = 'CREDITED',
  VOID = 'VOID',
}
