import { Address } from './address.entity';
import { Brand } from './brand.entity';
import { CartItem } from './cart-item.entity';
import { Category } from './category.entity';
import { MediaAsset } from './media-asset.entity';
import { Order } from './order.entity';
import { OrderItem } from './order-item.entity';
import { ProcessedWebhook } from './processed-webhook.entity';
import { Product } from './product.entity';
import { ProductVariant } from './product-variant.entity';
import { Referral } from './referral.entity';
import { RefreshToken } from './refresh-token.entity';
import { ReturnRequest } from './return-request.entity';
import { Review } from './review.entity';
import { SizeEnquiry } from './size-enquiry.entity';
import { User } from './user.entity';
import { Wallet } from './wallet.entity';
import { WalletTransaction } from './wallet-transaction.entity';

export * from './base.entity';
export * from './address.entity';
export * from './brand.entity';
export * from './cart-item.entity';
export * from './category.entity';
export * from './media-asset.entity';
export * from './order.entity';
export * from './order-item.entity';
export * from './processed-webhook.entity';
export * from './product.entity';
export * from './product-variant.entity';
export * from './referral.entity';
export * from './refresh-token.entity';
export * from './return-request.entity';
export * from './review.entity';
export * from './size-enquiry.entity';
export * from './user.entity';
export * from './wallet.entity';
export * from './wallet-transaction.entity';

/**
 * Explicit registry rather than a glob.
 *
 * TypeORM's `entities: ['dist/**\/*.entity.js']` pattern resolves differently
 * under ts-node (CLI, seeds) than under the compiled build, and a path that
 * silently matches nothing produces "No metadata for X was found" at runtime
 * instead of a build error. Listing them makes a missing entity a TypeScript
 * error at the point it is added.
 */
export const ENTITIES = [
  Address,
  Brand,
  CartItem,
  Category,
  MediaAsset,
  Order,
  OrderItem,
  ProcessedWebhook,
  Product,
  ProductVariant,
  Referral,
  RefreshToken,
  ReturnRequest,
  Review,
  SizeEnquiry,
  User,
  Wallet,
  WalletTransaction,
];
