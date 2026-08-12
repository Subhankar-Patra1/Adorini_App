import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * A hard ceiling per line. Retail carts are single-digit quantities; a request
 * for 10,000 of one size is either a typo or someone probing for an integer
 * overflow in the totals.
 */
const MAX_LINE_QUANTITY = 20;

export const addCartItemSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).default(1),
});

export const updateCartItemSchema = z
  .object({
    /** Supplying a different variant is how size/colour is changed inline. */
    variantId: z.uuid().optional(),
    quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).optional(),
  })
  .refine((body) => body.variantId !== undefined || body.quantity !== undefined, {
    error: 'Provide variantId, quantity, or both',
  });

export const cartQuerySchema = z.object({
  /**
   * How much wallet credit to preview against this cart. Only a *request* —
   * the server clamps it to the balance and to what is actually owed
   * (@GUARD Risk #3).
   */
  walletCreditPaise: z.coerce.number().int().nonnegative().optional().default(0),
  /** A candidate coupon code to preview. Eligibility is re-checked at placement — this is a preview only. */
  couponCode: z.string().trim().min(1).max(32).optional(),
});

export class AddCartItemDto extends createZodDto(addCartItemSchema) {}
export class UpdateCartItemDto extends createZodDto(updateCartItemSchema) {}
export class CartQueryDto extends createZodDto(cartQuerySchema) {}

// ---- responses ----

export const cartLineSchema = z.object({
  id: z.uuid(),
  variantId: z.uuid(),
  productId: z.string(),
  productSlug: z.string(),
  productName: z.string(),
  sku: z.string(),
  nominalSize: z.number().int(),
  colour: z.string(),
  unitPricePaise: z.number().int(),
  quantity: z.number().int(),
  lineTotalPaise: z.number().int(),
  stockQuantity: z.number().int(),
  inStock: z.boolean(),
});

export const orderTotalsSchema = z.object({
  subtotalPaise: z.number().int(),
  discountPaise: z.number().int(),
  /** Which promotion produced `discountPaise` — they never stack, see `PricingService`. */
  discountSource: z.enum(['FIRST_ORDER', 'COUPON', 'NONE']),
  deliveryFeePaise: z.number().int(),
  walletCreditPaise: z.number().int(),
  totalPaise: z.number().int(),
  /** Drives the "₹X away from free delivery" progress bar. */
  freeDeliveryShortfallPaise: z.number().int(),
  qualifiesForFreeDelivery: z.boolean(),
});

export const cartViewSchema = z.object({
  items: z.array(cartLineSchema),
  totals: orderTotalsSchema,
  isPurchasable: z.boolean(),
  /**
   * Set only when a `couponCode` was supplied and rejected — explains why to
   * the client. Silent when no code was given, and silent when the code
   * worked (`totals.discountSource === 'COUPON'` already says so).
   */
  couponMessage: z.string().nullable(),
});

export class CartViewDto extends createZodDto(cartViewSchema) {}
export class OrderTotalsDto extends createZodDto(orderTotalsSchema) {}
