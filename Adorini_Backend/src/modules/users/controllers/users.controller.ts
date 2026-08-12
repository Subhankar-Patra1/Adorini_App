import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import {
  ReferralCodeResponseDto,
  ReferralSummaryResponseDto,
  UpdateProfileDto,
} from '../dto/users.dto';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
import { UsersService, type ReferralSummary } from '../services/users.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PublicUserResponseDto } from '../../auth/dto/auth.dto';
import type { AuthUser } from '../../../common/types/auth-user';
import type { PublicUser } from '../../auth/services/auth.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the signed-in user profile' })
  @ApiResponse({ status: 200, type: PublicUserResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  getProfile(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.users.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update the signed-in user profile',
    description:
      'Phone number is not editable here — changing it requires verifying the new number by OTP.',
  })
  @ApiResponse({ status: 200, type: PublicUserResponseDto })
  @ApiResponse({ status: 409, description: 'That email is already in use' })
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<PublicUser> {
    return this.users.updateProfile(user.id, dto);
  }

  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!AVATAR_MIME_TYPES.has(file.mimetype)) {
          callback(new UnsupportedMediaTypeException(`Unsupported image type: ${file.mimetype}`), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace the profile photo' })
  @ApiResponse({ status: 200, type: PublicUserResponseDto })
  @ApiResponse({ status: 415, description: 'Unsupported image type' })
  uploadAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<PublicUser> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.users.updateAvatar(user.id, file);
  }

  @Get('me/referral-code')
  @ApiOperation({
    summary: 'Get the shareable referral code',
    description: 'Minted on first request, then stable for the life of the account.',
  })
  @ApiResponse({ status: 200, type: ReferralCodeResponseDto })
  getReferralCode(@CurrentUser() user: AuthUser): Promise<ReferralCodeResponseDto> {
    return this.users.getOrCreateReferralCode(user.id);
  }

  @Get('me/referrals')
  @ApiOperation({
    summary: 'List referrals made by the signed-in user',
    description:
      'Status and amounts only. Referees are never identified — sharing a code does not entitle you to their contact details.',
  })
  @ApiResponse({ status: 200, type: [ReferralSummaryResponseDto] })
  listReferrals(@CurrentUser() user: AuthUser): Promise<ReferralSummary[]> {
    return this.users.listReferrals(user.id);
  }
}
