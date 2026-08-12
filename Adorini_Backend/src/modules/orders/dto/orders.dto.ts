import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { OrderStatus, PaymentMethod, PaymentStatus } from '../../../common/enums/domain.enums';
import { phoneSchema } from '../../../common/utils/phone.util';

const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, { error: 'Must be a valid 6-digit Indian PIN code' });

/**
 * The delivery address, sent in full rather than as a saved-address id.
 *
 * An order snapshots its address (see `Order.shippingAddress`), so editing one
 * must not re-point at a saved row that could later change underneath it. The
 * shape matches the snapshot exactly.
 */
export const updateOrderAddressSchema = z.object({
  recipientName: z.string().trim().min(1).max(120),
  recipientPhone: phoneSchema,
  line1: z.string().trim().min(1).max(255),
  line2: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: pincodeSchema,
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(255).optional(),
});

export const listOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export class UpdateOrderAddressDto extends createZodDto(updateOrderAddressSchema) {}
export class CancelOrderDto extends createZodDto(cancelOrderSchema) {}
export class ListOrdersQueryDto extends createZodDto(listOrdersQuerySchema) {}

// ---- responses ----

const isoTimestamp = z.iso.datetime();

export const orderSummarySchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  status: z.enum(OrderStatus),
  paymentMethod: z.enum(PaymentMethod),
  paymentStatus: z.enum(PaymentStatus),
  totalPaise: z.number().int(),
  itemCount: z.number().int(),
  createdAt: isoTimestamp,
});

export const orderLineSchema = z.object({
  id: z.uuid(),
  productId: z.string().nullable(),
  productName: z.string(),
  sku: z.string(),
  nominalSize: z.number().int(),
  colour: z.string(),
  unitPricePaise: z.number().int(),
  quantity: z.number().int(),
  lineTotalPaise: z.number().int(),
});

export const shippingAddressSchema = z.object({
  recipientName: z.string(),
  recipientPhone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
});

export const orderDetailSchema = orderSummarySchema.extend({
  subtotalPaise: z.number().int(),
  discountPaise: z.number().int(),
  deliveryFeePaise: z.number().int(),
  walletCreditPaise: z.number().int(),
  shippingAddress: shippingAddressSchema,
  delhiveryWaybill: z.string().nullable(),
  codVerifiedAt: isoTimestamp.nullable(),
  shippedAt: isoTimestamp.nullable(),
  deliveredAt: isoTimestamp.nullable(),
  cancelledAt: isoTimestamp.nullable(),
  cancellationReason: z.string().nullable(),
  items: z.array(orderLineSchema),
  /** Drives whether the app shows an "edit address" button at all. */
  canEditAddress: z.boolean(),
  canCancel: z.boolean(),
});

export class OrderSummaryDto extends createZodDto(orderSummarySchema) {}
export class OrderDetailDto extends createZodDto(orderDetailSchema) {}
