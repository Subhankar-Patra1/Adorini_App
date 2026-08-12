import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';

import { PricingService, type CouponDiscountInput, type OrderTotals } from './pricing.service';
import { CartItem } from '../../../database/entities/cart-item.entity';
import { Order } from '../../../database/entities/order.entity';
import { ProductVariant } from '../../../database/entities/product-variant.entity';
import { CouponsService } from '../../coupons/services/coupons.service';

export interface CartLine {
  id: string;
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  sku: string;
  nominalSize: number;
  colour: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
  /** Live stock, so the client can grey out a line that can no longer be bought. */
  stockQuantity: number;
  inStock: boolean;
}

export interface CartView {
  items: CartLine[];
  totals: OrderTotals;
  /** True when every line is still purchasable — checkout refuses otherwise. */
  isPurchasable: boolean;
  /** Why a supplied coupon code was not applied; null when none was given or it worked. */
  couponMessage: string | null;
}

/**
 * A variant, joined to its product, as the cart needs it.
 *
 * `pricePaise` on the variant is an optional override; the product's price is
 * the fallback. Resolving that here keeps the rule in one place.
 */
interface ResolvedVariant {
  variant: ProductVariant;
  unitPricePaise: number;
  productSlug: string;
  productName: string;
  productId: string;
  isPurchasable: boolean;
}

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartItem) private readonly cartItems: Repository<CartItem>,
    @InjectRepository(ProductVariant) private readonly variants: Repository<ProductVariant>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly pricing: PricingService,
    private readonly coupons: CouponsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The buyer's cart, priced from the catalogue as it stands right now.
   *
   * Nothing about money is stored on the cart row, so a price change since the
   * item was added is reflected here rather than being discovered at checkout.
   */
  async getCart(
    userId: string,
    requestedWalletCreditPaise = 0,
    couponCode?: string,
  ): Promise<CartView> {
    const items = await this.cartItems.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });

    if (items.length === 0) {
      return {
        items: [],
        totals: this.pricing.calculate({ lines: [], isFirstOrder: false }),
        isPurchasable: false,
        couponMessage: null,
      };
    }

    const resolved = await this.resolveVariants(items.map((i) => i.variantId));

    const lines: CartLine[] = items.map((item) => {
      const info = resolved.get(item.variantId);

      if (!info) {
        // The variant vanished under the cart (hard-deleted by an admin). Show
        // the line as unbuyable rather than 500-ing the whole cart.
        return {
          id: item.id,
          variantId: item.variantId,
          productId: '',
          productSlug: '',
          productName: 'Unavailable item',
          sku: '',
          nominalSize: 0,
          colour: '',
          unitPricePaise: 0,
          quantity: item.quantity,
          lineTotalPaise: 0,
          stockQuantity: 0,
          inStock: false,
        };
      }

      return {
        id: item.id,
        variantId: item.variantId,
        productId: info.productId,
        productSlug: info.productSlug,
        productName: info.productName,
        sku: info.variant.sku,
        nominalSize: info.variant.nominalSize,
        colour: info.variant.colour,
        unitPricePaise: info.unitPricePaise,
        quantity: item.quantity,
        lineTotalPaise: info.unitPricePaise * item.quantity,
        stockQuantity: info.variant.stockQuantity,
        inStock: info.isPurchasable && info.variant.stockQuantity >= item.quantity,
      };
    });

    const isFirstOrder = await this.isFirstOrder(userId);
    const purchasableLines = lines.filter((l) => l.inStock);

    let couponDiscount: CouponDiscountInput | null = null;
    let couponMessage: string | null = null;

    if (couponCode) {
      const subtotalPaise = purchasableLines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
      const resolution = await this.coupons.preview(couponCode, userId, subtotalPaise);

      if (resolution.applied) {
        couponDiscount = {
          discountType: resolution.coupon.discountType,
          discountValue: resolution.coupon.discountValue,
          maxDiscountPaise: resolution.coupon.maxDiscountPaise,
        };
      } else {
        couponMessage = resolution.message;
      }
    }

    return {
      items: lines,
      totals: this.pricing.calculate({
        // Unbuyable lines are priced at zero above, so they cannot inflate a
        // total the buyer would then be asked to pay.
        lines: purchasableLines,
        isFirstOrder,
        requestedWalletCreditPaise,
        couponDiscount,
      }),
      isPurchasable: lines.length > 0 && lines.every((l) => l.inStock),
      couponMessage,
    };
  }

  /**
   * Adds a variant, or increases the quantity if it is already in the cart.
   *
   * Tapping "add to cart" twice on the same size means two of them, not an
   * error and not a duplicate line — `uq_cart_item_user_variant` guarantees the
   * one-line-per-variant shape.
   */
  async addItem(userId: string, variantId: string, quantity: number): Promise<CartView> {
    const info = await this.requirePurchasableVariant(variantId);

    const existing = await this.cartItems.findOne({ where: { userId, variantId } });
    const desired = (existing?.quantity ?? 0) + quantity;

    this.assertStock(info, desired);

    if (existing) {
      existing.quantity = desired;
      await this.cartItems.save(existing);
    } else {
      await this.cartItems.insert({ userId, variantId, quantity });
    }

    return this.getCart(userId);
  }

  /**
   * Changes a line's quantity, or its size/colour by pointing it at a different
   * variant — the inline editor the PDP offers.
   *
   * Switching to a variant already in the cart merges the two lines rather than
   * violating the uniqueness constraint, which is what a buyer means when they
   * change a second line to match the first.
   */
  async updateItem(
    userId: string,
    itemId: string,
    changes: { variantId?: string; quantity?: number },
  ): Promise<CartView> {
    await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(CartItem, { where: { id: itemId, userId } });

      if (!item) {
        throw new NotFoundException('Cart item not found');
      }

      const targetVariantId = changes.variantId ?? item.variantId;
      const targetQuantity = changes.quantity ?? item.quantity;
      const info = await this.requirePurchasableVariant(targetVariantId, manager);

      if (targetVariantId !== item.variantId) {
        const collidingLine = await manager.findOne(CartItem, {
          where: { userId, variantId: targetVariantId },
        });

        if (collidingLine) {
          const merged = collidingLine.quantity + targetQuantity;
          this.assertStock(info, merged);

          collidingLine.quantity = merged;
          await manager.save(CartItem, collidingLine);
          await manager.delete(CartItem, { id: item.id });
          return;
        }
      }

      this.assertStock(info, targetQuantity);

      item.variantId = targetVariantId;
      item.quantity = targetQuantity;
      await manager.save(CartItem, item);
    });

    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartView> {
    const result = await this.cartItems.delete({ id: itemId, userId });

    if (!result.affected) {
      // Scoped by userId in the delete itself, so another buyer's line is a
      // 404 rather than a silent success.
      throw new NotFoundException('Cart item not found');
    }

    return this.getCart(userId);
  }

  async clear(userId: string): Promise<CartView> {
    await this.cartItems.delete({ userId });
    return this.getCart(userId);
  }

  /** Used by checkout once an order has been placed from these items. */
  async clearWithin(manager: EntityManager, userId: string): Promise<void> {
    await manager.delete(CartItem, { userId });
  }

  /**
   * A buyer's first order is their first *placed* order, regardless of what
   * happened to it afterwards. Counting only delivered ones would hand the
   * discount out repeatedly to anyone who cancels.
   */
  async isFirstOrder(userId: string): Promise<boolean> {
    return (await this.orders.countBy({ userId })) === 0;
  }

  private async resolveVariants(variantIds: string[]): Promise<Map<string, ResolvedVariant>> {
    if (variantIds.length === 0) {
      return new Map();
    }

    const rows = await this.variants.find({
      where: { id: In(variantIds) },
      relations: { product: true },
    });

    return new Map(
      rows.map((variant) => [
        variant.id,
        {
          variant,
          // A variant may override its product's price; most do not.
          unitPricePaise: variant.pricePaise ?? variant.product.pricePaise,
          productId: variant.product.id,
          productSlug: variant.product.slug,
          productName: variant.product.name,
          isPurchasable: variant.isActive && variant.product.isActive,
        },
      ]),
    );
  }

  private async requirePurchasableVariant(
    variantId: string,
    manager?: EntityManager,
  ): Promise<ResolvedVariant> {
    const repo = manager ? manager.getRepository(ProductVariant) : this.variants;

    const variant = await repo.findOne({
      where: { id: variantId },
      relations: { product: true },
    });

    if (!variant || !variant.isActive || !variant.product.isActive) {
      throw new NotFoundException('That size is no longer available');
    }

    return {
      variant,
      unitPricePaise: variant.pricePaise ?? variant.product.pricePaise,
      productId: variant.product.id,
      productSlug: variant.product.slug,
      productName: variant.product.name,
      isPurchasable: true,
    };
  }

  /**
   * Refuses a quantity the shelf cannot cover.
   *
   * Checked here for a clear message, and again under a row lock at placement —
   * this check is advisory, because stock can be taken by someone else between
   * the two. The lock is what actually prevents overselling.
   */
  private assertStock(info: ResolvedVariant, quantity: number): void {
    if (quantity > info.variant.stockQuantity) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_STOCK',
        message:
          info.variant.stockQuantity === 0
            ? 'That size just sold out.'
            : `Only ${info.variant.stockQuantity} left in that size.`,
        availableQuantity: info.variant.stockQuantity,
      });
    }
  }
}
