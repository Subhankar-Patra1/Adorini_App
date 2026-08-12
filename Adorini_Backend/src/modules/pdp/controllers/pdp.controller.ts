import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnsupportedMediaTypeException,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';

import { CurrentUser, OptionalUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthUser } from '../../../common/types/auth-user';
import { PdpService } from '../services/pdp.service';
import { CreateSizeEnquiryDto, SizeEnquiryResponseDto } from '../dto/create-size-enquiry.dto';
import { ProductDetailDto } from '../dto/product-detail.dto';
import {
  CreateReviewDto,
  ListReviewsQueryDto,
  ReviewDto,
  ReviewListResponseDto,
} from '../dto/review.dto';

const MAX_REVIEW_PHOTOS = 5;
const MAX_REVIEW_PHOTO_BYTES = 5 * 1024 * 1024;
/** Kept in step with `MIME_EXTENSIONS` in `PdpService`, which is what actually names the uploaded object. */
const REVIEW_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@ApiTags('pdp')
@Controller('pdp')
export class PdpController {
  constructor(private readonly pdp: PdpService) { }

  /**
   * Product pages are browsable without an account — a shopper has to see a
   * product before deciding to sign up for it. `@Public()` sits on the
   * individual read routes rather than the class specifically so it cannot
   * accidentally spread to `createReview` below, which must stay protected.
   */
  @Public()
  @Get(':slug')
  @ApiOperation({
    summary: 'Product detail — gallery, variants, dynamic size chart, review summary',
  })
  @ApiOkResponse({ type: ProductDetailDto })
  getProductDetail(@Param('slug') slug: string): Promise<ProductDetailDto> {
    return this.pdp.getProductDetail(slug);
  }

  @Public()
  @Get(':slug/reviews')
  @ApiOperation({ summary: 'Reviews with fit tags and buyer photos, newest first' })
  @ApiOkResponse({ type: ReviewListResponseDto })
  listReviews(
    @Param('slug') slug: string,
    @Query() query: ListReviewsQueryDto,
  ): Promise<ReviewListResponseDto> {
    return this.pdp.listReviews(slug, query);
  }

  /**
   * Deliberately protected, unlike every other route on this controller — a
   * review is tied to the reviewer (`uq_review_user_product` is per user) and
   * the verified-purchase badge means something specific. There is no
   * `@Public()` here, so the global `JwtAuthGuard` runs normally and
   * `@CurrentUser()` is guaranteed a real id.
   *
   * multipart/form-data rather than JSON: photos ride alongside the review
   * fields in one request. `memoryStorage()` is mandatory — Railway's
   * filesystem is ephemeral, so writing to disk first would mean deploying a
   * new instance mid-upload loses the file, and R2 wants a buffer, not a path.
   */
  @Post(':slug/reviews')
  @UseInterceptors(
    FilesInterceptor('photos', MAX_REVIEW_PHOTOS, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_REVIEW_PHOTO_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!REVIEW_PHOTO_MIME_TYPES.has(file.mimetype)) {
          callback(new UnsupportedMediaTypeException(`Unsupported photo type: ${file.mimetype}`), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a review for a product, with up to 5 photos' })
  @ApiCreatedResponse({ type: ReviewDto })
  createReview(
    @Param('slug') slug: string,
    @Body() dto: CreateReviewDto,
    @CurrentUser() user: AuthUser,
    @UploadedFiles() photos: Express.Multer.File[] = [],
  ): Promise<ReviewDto> {
    return this.pdp.createReview(slug, dto, user.id, photos);
  }

  /**
   * Throttled far harder than the global 100/60s default: this is an
   * unauthenticated write that lands in a human's inbox, so the abuse case is
   * flooding the admin queue rather than exhausting the origin.
   *
   * Accepts an optional bearer token. A first-time visitor must be able to ask
   * about a size — that is the whole point of the fallback — but when the
   * enquiry comes from a signed-in customer it is attributed to them, so the
   * admin answering it can see their order history instead of a bare phone
   * number. `SizeEnquiry.userId` is nullable for exactly this reason.
   *
   * KNOWN GAP: `@Public()` makes `JwtAuthGuard` return early without ever
   * inspecting the Authorization header (see the guard), so `@OptionalUser()`
   * is actually unreachable here — it is always `undefined`, signed-in caller
   * or not. Fixing it needs the guard itself to gain a real "verify if
   * present, don't require it" mode, which is shared auth infrastructure this
   * change deliberately does not touch. Flagged rather than silently patched.
   */
  @Public()
  @Post(':slug/size-enquiry')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Request a size outside the stocked 40–48 band',
    description:
      'Works signed-out. If a valid bearer token is supplied the enquiry is linked to that account.',
  })
  @ApiCreatedResponse({ type: SizeEnquiryResponseDto })
  createSizeEnquiry(
    @Param('slug') slug: string,
    @Body() dto: CreateSizeEnquiryDto,
    @OptionalUser() user: AuthUser | undefined,
  ): Promise<SizeEnquiryResponseDto> {
    return this.pdp.createSizeEnquiry(slug, dto, user?.id ?? null);
  }
}
