import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CheckoutController } from './controllers/checkout.controller';
import { CheckoutService } from './services/checkout.service';
import { Address } from '../../database/entities/address.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { User } from '../../database/entities/user.entity';
import { Wallet } from '../../database/entities/wallet.entity';
import { WalletTransaction } from '../../database/entities/wallet-transaction.entity';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PaymentsModule } from '../../providers/payments/payments.module';
import { SmsModule } from '../../providers/sms/sms.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      CartItem,
      ProductVariant,
      Address,
      User,
      Wallet,
      WalletTransaction,
    ]),
    // Cart supplies both the items and the pricing rules, so the quote and the
    // charge cannot diverge.
    CartModule,
    CouponsModule,
    // AuthModule exports OtpService — COD intent verification reuses the same
    // OTP machinery as login, including its attempt caps and cooldowns.
    AuthModule,
    SmsModule,
    PaymentsModule,
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
