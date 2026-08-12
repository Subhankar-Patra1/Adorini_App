import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { OrderStatus, PaymentMethod } from '../../../common/enums/domain.enums';

/**
 * Note what this body does **not** contain: no prices, no discount, no delivery
 * fee, no total. The client chooses *what* to buy and *how* to pay; every
 * amount is derived server-side from the catalogue (@GUARD Risk #3). There is
 * deliberately no field a tampered request could use to change what is charged.
 */
export const placeOrderSchema = z.object({
  addressId: z.uuid(),
  paymentMethod: z.enum(PaymentMethod),
  /**
   * How much store credit to spend. A *request*: the server clamps it to the
   * actual balance and to what is still owed, so an inflated value cannot
   * produce a negative total.
   */
  walletCreditPaise: z.number().int().nonnegative().optional().default(0),
});

export const verifyCodSchema = z.object({
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, { error: 'OTP must be 6 digits' }),
});

export class PlaceOrderDto extends createZodDto(placeOrderSchema) {}
export class VerifyCodDto extends createZodDto(verifyCodSchema) {}

// ---- responses ----

export const placedOrderSchema = z.object({
  orderId: z.uuid(),
  orderNumber: z.string(),
  status: z.enum(OrderStatus),
  paymentMethod: z.enum(PaymentMethod),
  totalPaise: z.number().int(),
  /** Prepaid only — the handle the Cashfree SDK opens. Null for COD. */
  paymentSessionId: z.string().nullable(),
  /** True when a COD intent code has been sent and must be confirmed. */
  requiresCodVerification: z.boolean(),
});

export const codVerifiedSchema = z.object({
  status: z.enum(OrderStatus),
});

export const codResentSchema = z.object({
  expiresInSeconds: z.number().int(),
});

export class PlacedOrderDto extends createZodDto(placedOrderSchema) {}
export class CodVerifiedDto extends createZodDto(codVerifiedSchema) {}
export class CodResentDto extends createZodDto(codResentSchema) {}
