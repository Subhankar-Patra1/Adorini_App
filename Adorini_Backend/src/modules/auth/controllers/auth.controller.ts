import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request } from 'express';

import {
  GoogleAuthenticatedResponseDto,
  GooglePhoneRequiredResponseDto,
  GoogleSignInDto,
  LoginResultResponseDto,
  LogoutDto,
  OtpRequestedResponseDto,
  PublicUserResponseDto,
  RefreshTokenDto,
  RefreshedTokensResponseDto,
  RequestOtpDto,
  VerifyOtpDto,
} from '../dto/auth.dto';
import { AuthService, type GoogleSignInResult } from '../services/auth.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthUser } from '../../../common/types/auth-user';
import type { SessionContext } from '../services/token.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send a login code by SMS',
    description:
      'Returns the same response whether or not the number has an account, so this endpoint cannot be used to discover who is a customer.',
  })
  @ApiResponse({ status: 202, type: OtpRequestedResponseDto })
  @ApiResponse({ status: 400, description: 'Resend cooldown or hourly limit hit' })
  @ApiResponse({ status: 503, description: 'SMS provider unavailable' })
  requestOtp(@Body() dto: RequestOtpDto): Promise<OtpRequestedResponseDto> {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a login code, signing in or registering',
    description:
      'The only endpoint that creates an account. Pass registrationToken to finish a signup started with Google, and referralCode to record a referral.',
  })
  @ApiResponse({ status: 200, type: LoginResultResponseDto })
  @ApiResponse({ status: 401, description: 'Code incorrect, expired, or too many attempts' })
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() request: Request): Promise<LoginResultResponseDto> {
    return this.auth.verifyOtp({
      phone: dto.phone,
      otp: dto.otp,
      registrationToken: dto.registrationToken,
      referralCode: dto.referralCode,
      context: sessionContext(request),
    });
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with Google',
    description:
      'Returns AUTHENTICATED for an existing account, or PHONE_REQUIRED with a registrationToken when a phone still has to be verified before the account can be created. Branch on `status`.',
  })
  @ApiExtraModels(GoogleAuthenticatedResponseDto, GooglePhoneRequiredResponseDto)
  @ApiResponse({
    status: 200,
    schema: {
      oneOf: [
        { $ref: getSchemaPath(GoogleAuthenticatedResponseDto) },
        { $ref: getSchemaPath(GooglePhoneRequiredResponseDto) },
      ],
      discriminator: { propertyName: 'status' },
    },
  })
  @ApiResponse({ status: 401, description: 'Google rejected the token' })
  @ApiResponse({ status: 503, description: 'Google unreachable' })
  signInWithGoogle(
    @Body() dto: GoogleSignInDto,
    @Req() request: Request,
  ): Promise<GoogleSignInResult> {
    return this.auth.signInWithGoogle(dto.idToken, sessionContext(request));
  }

  @Post('google/link')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Link a Google account to the signed-in user' })
  @ApiResponse({ status: 200, type: PublicUserResponseDto })
  @ApiResponse({ status: 409, description: 'Google account already linked elsewhere' })
  linkGoogle(
    @CurrentUser() user: AuthUser,
    @Body() dto: GoogleSignInDto,
  ): Promise<PublicUserResponseDto> {
    return this.auth.linkGoogle(user.id, dto.idToken);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new pair',
    description:
      'Refresh tokens are single-use. Presenting one that has already been rotated is treated as a leak and revokes every session for that user.',
  })
  @ApiResponse({ status: 200, type: RefreshedTokensResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or already-used token' })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<RefreshedTokensResponseDto> {
    return this.auth.refresh(dto.refreshToken, sessionContext(request));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke one refresh token',
    description: 'Idempotent — an unknown or already-revoked token still returns 204.',
  })
  @ApiResponse({ status: 204, description: 'Session ended' })
  logout(@Body() dto: LogoutDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every refresh token for the signed-in user' })
  @ApiResponse({ status: 204, description: 'All sessions ended' })
  logoutAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.logoutAll(user.id);
  }
}

/** Captures where a session was created, for a future "your devices" screen. */
function sessionContext(request: Request): SessionContext {
  return {
    userAgent: request.get('user-agent') ?? null,
    ipAddress: request.ip ?? null,
  };
}
