import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { PdpService } from '../services/pdp.service';
import { CreateSizeEnquiryDto, SizeEnquiryResponseDto } from '../dto/create-size-enquiry.dto';
import { ProductDetailDto } from '../dto/product-detail.dto';
import { ListReviewsQueryDto, ReviewListResponseDto } from '../dto/review.dto';
import { OptionalUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthUser } from '../../../common/types/auth-user';

/**
 * Product pages are browsable without an account — a shopper has to be able to
 * see a product before deciding to sign up for it.
 *
 * `@Public()` is mandatory rather than optional: authentication is global and
 * fail-closed (ADR-013), so without it every product page answers 401.
 */
@Public()
@ApiTags('pdp')
@Controller('pdp')
export class PdpController {
  constructor(private readonly pdp: PdpService) {}

  @Get(':slug')
  @ApiOperation({
    summary: 'Product detail — gallery, variants, dynamic size chart, review summary',
  })
  @ApiOkResponse({ type: ProductDetailDto })
  getProductDetail(@Param('slug') slug: string): Promise<ProductDetailDto> {
    return this.pdp.getProductDetail(slug);
  }

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
   * Throttled far harder than the global 100/60s default: this is an
   * unauthenticated write that lands in a human's inbox, so the abuse case is
   * flooding the admin queue rather than exhausting the origin.
   *
   * Accepts an optional bearer token. A first-time visitor must be able to ask
   * about a size — that is the whole point of the fallback — but when the
   * enquiry comes from a signed-in customer it is attributed to them, so the
   * admin answering it can see their order history instead of a bare phone
   * number. `SizeEnquiry.userId` is nullable for exactly this reason.
   */
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
