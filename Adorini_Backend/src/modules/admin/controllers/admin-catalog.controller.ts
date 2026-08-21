import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnsupportedMediaTypeException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import {
  AdminBrandDto,
  AdminCategoryDto,
  AdminEnquiryDto,
  AdminMediaDto,
  AdminProductDto,
  AdminVariantDto,
  CreateProductDto,
  CreateVariantDto,
  ListAdminProductsQueryDto,
  ListEnquiriesQueryDto,
  RespondToEnquiryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from '../dto/admin.dto';
import { AdminCatalogService } from '../services/admin-catalog.service';
import {
  SearchAnalyticsService,
  type SearchAnalyticsReport,
} from '../services/search-analytics.service';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { NoStoreInterceptor } from '../../../common/interceptors/no-store.interceptor';

/** Matches the PRD's stated gallery cap (see `MediaAsset.displayOrder`'s doc comment). */
const MAX_PRODUCT_IMAGES = 5;
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
/** Kept in step with `MEDIA_MIME_EXTENSIONS` in `AdminCatalogService`. */
const PRODUCT_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Store-owner tools.
 *
 * `AdminGuard` runs after the global `JwtAuthGuard`: authentication says who is
 * calling, this says whether they are staff. It re-reads `is_admin` from the
 * database each time rather than trusting a token claim, so revoking someone's
 * access takes effect immediately rather than at the end of their 15-minute
 * token (see the guard for the full reasoning).
 *
 * `no-store` because these responses include unreleased pricing and buyers'
 * contact details from the enquiry inbox.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@UseInterceptors(NoStoreInterceptor)
@Controller('admin')
export class AdminCatalogController {
  constructor(
    private readonly admin: AdminCatalogService,
    private readonly searchAnalytics: SearchAnalyticsService,
  ) {}

  /**
   * What shoppers searched for, and what they searched for and did not find.
   *
   * `unmetDemand` is the merchandising output: terms returning zero results are
   * a buying list written by the people who wanted to spend money and could not.
   */
  @Get('search-analytics')
  @ApiOperation({ summary: 'Search terms and unmet demand over a window' })
  searchAnalyticsReport(
    @Query('windowDays') windowDays?: string,
    @Query('limit') limit?: string,
  ): Promise<SearchAnalyticsReport> {
    // Clamped rather than validated into a 400: this is a dashboard read, and
    // a nonsense window should give a sane report, not an error page.
    const days = Math.min(Math.max(Number(windowDays) || 30, 1), 365);
    const rows = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.searchAnalytics.report(days, rows);
  }

  @Get('categories')
  @ApiOperation({
    summary: 'List categories with ids, for building the product-creation form',
    description:
      'Unlike GET /catalog/categories, this includes the id every admin write needs and does not hide inactive rows.',
  })
  @ApiResponse({ status: 200, type: [AdminCategoryDto] })
  listCategories() {
    return this.admin.listCategoriesForAdmin();
  }

  @Get('brands')
  @ApiOperation({
    summary: 'List brands with ids, for building the product-creation form',
    description:
      'Unlike GET /catalog/brands, this includes the id every admin write needs and does not hide inactive rows.',
  })
  @ApiResponse({ status: 200, type: [AdminBrandDto] })
  listBrands() {
    return this.admin.listBrandsForAdmin();
  }

  @Get('products')
  @ApiOperation({
    summary: 'List products, including inactive ones',
    description: 'Unlike the public catalogue, this shows unpublished and deactivated products.',
  })
  @ApiResponse({ status: 200, type: [AdminProductDto] })
  @ApiResponse({ status: 403, description: 'Not an administrator' })
  listProducts(@Query() query: ListAdminProductsQueryDto) {
    return this.admin.listProducts(query.includeInactive, query.limit, query.offset);
  }

  @Post('products')
  @ApiOperation({
    summary: 'Create a product',
    description:
      'A supplied size chart is validated against the shared size_rules schema and must match the product’s fabric type (@GUARD Risk #5). Malformed charts are rejected, never stored.',
  })
  @ApiResponse({ status: 201, type: AdminProductDto })
  @ApiResponse({ status: 400, description: 'Invalid size chart, or unknown category/brand' })
  @ApiResponse({ status: 409, description: 'Slug already in use' })
  createProduct(@Body() dto: CreateProductDto) {
    return this.admin.createProduct(dto);
  }

  @Post('products/:id/media')
  @UseInterceptors(
    FilesInterceptor('images', MAX_PRODUCT_IMAGES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!PRODUCT_IMAGE_MIME_TYPES.has(file.mimetype)) {
          callback(
            new UnsupportedMediaTypeException(`Unsupported image type: ${file.mimetype}`),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload admin-curated gallery images for a product',
    description:
      'The first image ever uploaded for a product becomes its catalog thumbnail. Up to 5 per call, matching the PRD gallery cap.',
  })
  @ApiResponse({ status: 201, type: [AdminMediaDto] })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 415, description: 'Unsupported image type' })
  uploadProductMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() images: Express.Multer.File[] = [],
  ) {
    return this.admin.attachProductMedia(id, images);
  }

  @Patch('products/:id')
  @ApiOperation({
    summary: 'Update a product',
    description:
      'Changing fabric type re-validates the existing size chart against it, so a stretch chart cannot be left attached to a rigid garment.',
  })
  @ApiResponse({ status: 200, type: AdminProductDto })
  @ApiResponse({ status: 400, description: 'Size chart invalid or contradicts the fabric type' })
  updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.admin.updateProduct(id, dto);
  }

  @Get('products/:id/variants')
  @ApiOperation({ summary: 'List a product’s size/colour variants' })
  @ApiResponse({ status: 200, type: [AdminVariantDto] })
  listVariants(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.listVariants(id);
  }

  @Post('variants')
  @ApiOperation({ summary: 'Add a size/colour variant' })
  @ApiResponse({ status: 201, type: AdminVariantDto })
  @ApiResponse({ status: 409, description: 'Duplicate SKU or size/colour for this product' })
  createVariant(@Body() dto: CreateVariantDto) {
    return this.admin.createVariant(dto);
  }

  @Patch('variants/:id')
  @ApiOperation({
    summary: 'Update a variant — stock, price override, or availability',
    description:
      'Stock cannot go negative; the database check constraint is the backstop if a bad value reaches it.',
  })
  @ApiResponse({ status: 200, type: AdminVariantDto })
  updateVariant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVariantDto) {
    return this.admin.updateVariant(id, dto);
  }

  @Get('size-enquiries')
  @ApiOperation({
    summary: 'The custom-size enquiry inbox',
    description:
      'Also demand data: a cluster of requests for one size is the evidence for extending the stocked band.',
  })
  @ApiResponse({ status: 200, type: [AdminEnquiryDto] })
  listEnquiries(@Query() query: ListEnquiriesQueryDto) {
    return this.admin.listEnquiries(query.status, query.limit, query.offset);
  }

  @Patch('size-enquiries/:id')
  @ApiOperation({ summary: 'Respond to or close a size enquiry' })
  @ApiResponse({ status: 200, type: AdminEnquiryDto })
  respondToEnquiry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondToEnquiryDto) {
    return this.admin.respondToEnquiry(id, dto.status, dto.adminResponse);
  }
}
