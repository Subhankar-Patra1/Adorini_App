import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { OtpService } from './services/otp.service';
import { RegistrationService } from './services/registration.service';
import { TokenService } from './services/token.service';
import { Referral, RefreshToken, User, Wallet } from '../../database/entities';
import { durationToSeconds } from '../../common/utils/duration.util';
import { OAuthModule } from '../../providers/oauth/oauth.module';
import { SmsModule } from '../../providers/sms/sms.module';
import type { Env } from '../../config/env.validation';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Wallet, Referral, RefreshToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          expiresIn: durationToSeconds(config.get('JWT_ACCESS_EXPIRES_IN', { infer: true })),
        },
      }),
    }),
    SmsModule,
    OAuthModule,
    // RedisModule is @Global and imported once in AppModule.
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokenService, RegistrationService],
  // TokenService is exported because JwtModule's configuration lives here;
  // later modules that need to mint or revoke sessions reuse it rather than
  // re-deriving the signing setup.
  exports: [AuthService, TokenService, JwtModule],
})
export class AuthModule {}
