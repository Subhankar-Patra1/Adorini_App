import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';

import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  WalletTransactionType,
} from '../../../common/enums/domain.enums';
import { maskPhone } from '../../../common/utils/phone.util';
import { Address } from '../../../database/entities/address.entity';
import { CartItem } from '../../../database/entities/cart-item.entity';
import { Order, type ShippingAddressSnapshot } from '../../../database/entities/order.entity';
import { OrderItem } from '../../../database/entities/order-item.entity';
import { ProductVariant } from '../../../database/entities/product-variant.entity';
import { User } from '../../../database/entities/user.entity';
import { Wallet } from '../../../database/entities/wallet.entity';
import { WalletTransaction } from '../../../database/entities/wallet-transaction.entity';
import { CartService } from '../../cart/services/cart.service';
import { PricingService } from '../../cart/services/pricing.service';
import { OtpService } from '../../auth/services/otp.service';
import { SmsService } from '../../../providers/sms/sms.service';
import { PaymentsService } from '../../../providers/payments/payments.service';
import type { Env } from '../../../config/env.validation';

export interface PlaceOrderInput {
  userId: string;
  addressId: string;
  paymentMethod: PaymentMethod;
  /** A request, not an instruction — clamped to the balance and to what is owed. */
  walletCreditPaise?: number;
}

export interface PlacedOrder {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  totalPaise: number;
  /** Present for prepaid orders — the handle the Flutter SDK opens. */
  paymentSessionId: string | null;
  /** True when a COD intent OTP has been sent and must be confirmed. */
  requiresCodVerification: boolean;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly cashfreeEnabled: boolean;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly cart: CartService,
    private readonly pricing: PricingService,
    private readonly otp: OtpService,
    private readonly sms: SmsService,
    private readonly payments: PaymentsService,
    config: ConfigService<Env, true>,
  ) {
    // Placeholder credentials cannot open a real payment session. Production
    // boot already refuses them outright (see env validation); locally this
    // keeps COD testable without pretending prepaid works.
    this.cashfreeEnabled = !/placeholder/i.test(config.get('CASHFREE_APP_ID', { infer: true }));
  }

  /**
   * Turns the cart into an order.
   *
   * Everything that decides money or stock happens inside one transaction, in
   * this order:
   *
   *   1. lock every variant involved (`SELECT … FOR UPDATE`)
   *   2. re-read prices and stock *under that lock*
   *   3. recompute totals server-side (@GUARD Risk #3)
   *   4. decrement stock, conditionally, and check it actually applied
   *   5. write the order, its lines, and any wallet debit
   *   6. empty the cart
   *
   * The locks are taken before anything is read for pricing, so two buyers
   * racing for the last unit serialise here rather than both being told they
   * got it. If any step fails the whole thing rolls back — no order without
   * stock, no stock taken without an order.
   */
  async placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
    const { userId, addressId, paymentMethod } = input;

    const address = await this.addresses.findOne({ where: { id: addressId, userId } });
    if (!address) {
      throw new NotFoundException('Delivery address not found');
    }

    const order = await this.dataSource.transaction(async (manager) => {
      const cartItems = await manager.find(CartItem, {
        where: { userId },
        order: { createdAt: 'ASC' },
      });

      if (cartItems.length === 0) {
        throw new BadRequestException({
          code: 'CART_EMPTY',
          message: 'Your cart is empty.',
        });
      }

      const variants = await this.lockVariants(
        manager,
        cartItems.map((item) => item.variantId),
      );

      const lines = cartItems.map((item) => {
        const variant = variants.get(item.variantId);

        if (!variant || !variant.isActive || !variant.product.isActive) {
          throw new ConflictException({
            code: 'ITEM_UNAVAILABLE',
            message: 'An item in your cart is no longer available. Please review your cart.',
          });
        }

        if (variant.stockQuantity < item.quantity) {
          throw new ConflictException({
            code: 'INSUFFICIENT_STOCK',
            message: `${variant.product.name} (size ${variant.nominalSize}) no longer has enough stock.`,
            variantId: variant.id,
            availableQuantity: variant.stockQuantity,
          });
        }

        // Priced from the row just read under lock — never from anything the
        // client sent, and never from a value cached on the cart.
        const unitPricePaise = variant.pricePaise ?? variant.product.pricePaise;

        return {
          variant,
          quantity: item.quantity,
          unitPricePaise,
          lineTotalPaise: unitPricePaise * item.quantity,
        };
      });

      const isFirstOrder = (await manager.countBy(Order, { userId })) === 0;
      const wallet = await this.lockWallet(manager, userId);

      const totals = this.pricing.calculate({
        lines,
        isFirstOrder,
        requestedWalletCreditPaise: input.walletCreditPaise ?? 0,
        availableWalletCreditPaise: wallet?.balancePaise ?? 0,
      });

      await this.decrementStock(manager, lines);

      const saved = await manager.save(
        Order,
        manager.create(Order, {
          orderNumber: await this.nextOrderNumber(manager),
          userId,
          status: OrderStatus.ORDERED,
          paymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          shippingAddress: snapshotAddress(address),
          subtotalPaise: totals.subtotalPaise,
          discountPaise: totals.discountPaise,
          deliveryFeePaise: totals.deliveryFeePaise,
          walletCreditPaise: totals.walletCreditPaise,
          totalPaise: totals.totalPaise,
        }),
      );

      await manager.insert(
        OrderItem,
        lines.map((line) => ({
          orderId: saved.id,
          variantId: line.variant.id,
          productId: line.variant.product.id,
          // Snapshotted: a rename or reprice next season must not rewrite what
          // this invoice says was bought.
          productName: line.variant.product.name,
          sku: line.variant.sku,
          nominalSize: line.variant.nominalSize,
          colour: line.variant.colour,
          unitPricePaise: line.unitPricePaise,
          quantity: line.quantity,
          lineTotalPaise: line.lineTotalPaise,
        })),
      );

      if (totals.walletCreditPaise > 0 && wallet) {
        await this.debitWallet(manager, wallet, totals.walletCreditPaise, saved.id);
      }

      await this.cart.clearWithin(manager, userId);

      return saved;
    });

    return this.afterPlacement(order, input.userId);
  }

  /**
   * Confirms a COD order's intent OTP.
   *
   * COD is the default here and costs real money to get wrong — an unverified
   * order ships goods to someone who never asked for them. The order stays in
   * `PENDING_VERIFICATION` until this clears.
   */
  async verifyCodOtp(
    userId: string,
    orderId: string,
    code: string,
  ): Promise<{ status: OrderStatus }> {
    const order = await this.orders.findOne({ where: { id: orderId, userId } });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status === OrderStatus.CONFIRMED) {
      // Idempotent: a double-tap on "verify" must not look like a failure.
      return { status: order.status };
    }

    if (order.status !== OrderStatus.PENDING_VERIFICATION) {
      throw new ConflictException({
        code: 'ORDER_NOT_AWAITING_VERIFICATION',
        message: 'This order is not waiting for verification.',
      });
    }

    const user = await this.users.findOneByOrFail({ id: userId });
    const result = await this.otp.verifyOtp(codOtpKey(user.phone, orderId), code);

    if (!result.valid) {
      throw new BadRequestException({
        code: `OTP_${result.reason}`,
        message:
          result.reason === 'TOO_MANY_ATTEMPTS'
            ? 'Too many incorrect attempts. Please request a new code.'
            : 'That code is incorrect or has expired.',
      });
    }

    order.status = OrderStatus.CONFIRMED;
    order.codVerifiedAt = new Date();
    await this.orders.save(order);

    this.logger.log(`COD order ${order.orderNumber} verified`);
    return { status: order.status };
  }

  /** Re-sends the COD intent code, subject to the same cooldown as login. */
  async resendCodOtp(userId: string, orderId: string): Promise<{ expiresInSeconds: number }> {
    const order = await this.orders.findOne({ where: { id: orderId, userId } });

    if (!order || order.status !== OrderStatus.PENDING_VERIFICATION) {
      throw new NotFoundException('No order awaiting verification');
    }

    const user = await this.users.findOneByOrFail({ id: userId });
    return this.sendCodOtp(user.phone, order);
  }

  // ---- internals ----

  /**
   * Everything after the order row exists.
   *
   * Deliberately outside the placement transaction: it calls MSG91 and
   * Cashfree, and an external timeout must not roll back an order whose stock
   * is already committed. If the OTP send fails the order still exists and the
   * buyer can ask for a new code.
   */
  private async afterPlacement(order: Order, userId: string): Promise<PlacedOrder> {
    if (order.paymentMethod === PaymentMethod.COD) {
      order.status = OrderStatus.PENDING_VERIFICATION;
      await this.orders.save(order);

      const user = await this.users.findOneByOrFail({ id: userId });
      await this.sendCodOtp(user.phone, order);

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentMethod: order.paymentMethod,
        totalPaise: order.totalPaise,
        paymentSessionId: null,
        requiresCodVerification: true,
      };
    }

    const paymentSessionId = await this.openPaymentSession(order, userId);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      totalPaise: order.totalPaise,
      paymentSessionId,
      requiresCodVerification: false,
    };
  }

  private async openPaymentSession(order: Order, userId: string): Promise<string | null> {
    if (!this.cashfreeEnabled) {
      this.logger.warn(
        `Cashfree not configured; order ${order.orderNumber} has no payment session`,
      );
      return null;
    }

    const user = await this.users.findOneByOrFail({ id: userId });

    const session = await this.payments.createPaymentSession(order.orderNumber, order.totalPaise, {
      id: user.id,
      name: user.fullName ?? 'Adorini customer',
      email: user.email ?? `${user.phone}@placeholder.adorini`,
      phone: user.phone,
    });

    // Recorded so the Cashfree webhook can find this order by its own handle.
    order.cashfreeOrderId = session.orderId;
    await this.orders.save(order);

    return session.paymentSessionId;
  }

  private async sendCodOtp(phone: string, order: Order): Promise<{ expiresInSeconds: number }> {
    const outcome = await this.otp.requestOtp(codOtpKey(phone, order.id));

    if (!outcome.allowed) {
      throw new BadRequestException({
        code: 'OTP_COOLDOWN',
        message: `Please wait ${outcome.retryAfterSeconds}s before requesting another code.`,
        retryAfterSeconds: outcome.retryAfterSeconds,
      });
    }

    await this.sms.sendOtp(phone, outcome.otp);
    this.logger.log(`COD verification code sent for ${order.orderNumber} to ${maskPhone(phone)}`);

    return { expiresInSeconds: outcome.expiresInSeconds };
  }

  /**
   * Locks every variant in the cart, in a deterministic order.
   *
   * Ordering by id matters: two carts sharing two variants in opposite orders
   * would deadlock if each locked them in its own sequence. Postgres would
   * detect it and abort one at random, turning a busy checkout into sporadic,
   * unreproducible failures.
   */
  private async lockVariants(
    manager: EntityManager,
    variantIds: string[],
  ): Promise<Map<string, ProductVariant>> {
    const ordered = [...new Set(variantIds)].sort();

    const rows = await manager
      .createQueryBuilder(ProductVariant, 'variant')
      .innerJoinAndSelect('variant.product', 'product')
      .where('variant.id IN (:...ids)', { ids: ordered })
      .orderBy('variant.id', 'ASC')
      .setLock('pessimistic_write')
      // Product rows are only read, and locking them would serialise unrelated
      // carts that happen to share a product.
      .setOnLocked('nowait')
      .getMany()
      .catch(() => {
        throw new ConflictException({
          code: 'CHECKOUT_BUSY',
          message: 'Someone else is buying one of these items. Please try again.',
        });
      });

    return new Map(rows.map((row) => [row.id, row]));
  }

  private async lockWallet(manager: EntityManager, userId: string): Promise<Wallet | null> {
    return manager.findOne(Wallet, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Conditional decrement — the `WHERE stock_quantity >= :quantity` is what
   * actually prevents overselling. If it matches no rows, someone took the
   * stock between our read and our write despite the lock, and the whole
   * transaction is abandoned rather than shipping goods that do not exist.
   */
  private async decrementStock(
    manager: EntityManager,
    lines: { variant: ProductVariant; quantity: number }[],
  ): Promise<void> {
    for (const line of lines) {
      const result = await manager
        .createQueryBuilder()
        .update(ProductVariant)
        .set({ stockQuantity: () => `"stock_quantity" - ${line.quantity}` })
        .where('id = :id AND stock_quantity >= :quantity', {
          id: line.variant.id,
          quantity: line.quantity,
        })
        .execute();

      if (!result.affected) {
        throw new ConflictException({
          code: 'INSUFFICIENT_STOCK',
          message: `${line.variant.product.name} (size ${line.variant.nominalSize}) just sold out.`,
          variantId: line.variant.id,
        });
      }
    }
  }

  private async debitWallet(
    manager: EntityManager,
    wallet: Wallet,
    amountPaise: number,
    orderId: string,
  ): Promise<void> {
    wallet.balancePaise -= amountPaise;
    await manager.save(Wallet, wallet);

    await manager.save(
      WalletTransaction,
      manager.create(WalletTransaction, {
        walletId: wallet.id,
        type: WalletTransactionType.ORDER_DEBIT,
        // Signed negative: the ledger's sign must match the type, and the
        // database check constraint enforces it.
        amountPaise: -amountPaise,
        balanceAfterPaise: wallet.balancePaise,
        referenceId: orderId,
        description: 'Applied to order',
      }),
    );
  }

  /**
   * A human-quotable reference, distinct from the UUID primary key.
   *
   * Derived from a per-year count rather than a global sequence so the number
   * stays short. The uniqueness guarantee is the `order_number` unique index,
   * not this arithmetic — a collision under concurrency surfaces as a failed
   * insert and a retried checkout rather than two orders sharing a reference.
   */
  private async nextOrderNumber(manager: EntityManager): Promise<string> {
    const year = new Date().getFullYear();
    const countThisYear = await manager
      .createQueryBuilder(Order, 'o')
      .where(`o.order_number LIKE :prefix`, { prefix: `ADR-${year}-%` })
      .getCount();

    return `ADR-${year}-${String(countThisYear + 1).padStart(6, '0')}`;
  }
}

/**
 * COD verification codes are namespaced per order.
 *
 * Sharing the login OTP keyspace would let a login code confirm a COD order, or
 * a stale order code satisfy a login — and requesting one would silently cancel
 * the other, since issuing a code overwrites the previous one for that key.
 */
function codOtpKey(phone: string, orderId: string): string {
  return `cod:${orderId}:${phone}`;
}

function snapshotAddress(address: Address): ShippingAddressSnapshot {
  return {
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
  };
}
