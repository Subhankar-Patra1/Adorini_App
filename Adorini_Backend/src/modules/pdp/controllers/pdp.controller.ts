import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { PdpService } from '../services/pdp.service';
import { CreateSizeEnquiryDto, SizeEnquiryResponseDto } from '../dto/create-size-enquiry.dto';
import { ProductDetailDto } from '../dto/product-detail.dto';
import { ListReviewsQueryDto, ReviewListResponseDto } from '../dto/review.dto';

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
   */
  @Post(':slug/size-enquiry')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Request a size outside the stocked 40–48 band' })
  @ApiCreatedResponse({ type: SizeEnquiryResponseDto })
  createSizeEnquiry(
    @Param('slug') slug: string,
    @Body() dto: CreateSizeEnquiryDto,
  ): Promise<SizeEnquiryResponseDto> {
    return this.pdp.createSizeEnquiry(slug, dto);
  }
}
