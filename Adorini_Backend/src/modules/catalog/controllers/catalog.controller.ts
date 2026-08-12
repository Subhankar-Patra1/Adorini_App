import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CatalogService } from '../services/catalog.service';
import { BrandDto } from '../dto/brand.dto';
import { CategoryDto } from '../dto/category.dto';
import { ListProductsQueryDto } from '../dto/list-products-query.dto';
import { ProductListResponseDto } from '../dto/product-summary.dto';
import { Public } from '../../../common/decorators/public.decorator';

/**
 * Browsing the catalogue requires no account — a shopper must be able to see
 * what is for sale before deciding to sign up.
 *
 * `@Public()` is mandatory here rather than optional: authentication is
 * registered globally and fail-closed (ADR-013), so without it every one of
 * these routes answers 401 and the storefront is unreachable.
 */
@Public()
@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Garment-type tabs shown on the catalog screen' })
  @ApiOkResponse({ type: CategoryDto, isArray: true })
  listCategories(): Promise<CategoryDto[]> {
    return this.catalog.listCategories();
  }

  @Get('brands')
  @ApiOperation({ summary: '"Shop by brand" rail entries' })
  @ApiOkResponse({ type: BrandDto, isArray: true })
  listBrands(): Promise<BrandDto[]> {
    return this.catalog.listBrands();
  }

  @Get('products')
  @ApiOperation({
    summary: 'Search and filter the catalog with cursor-based infinite scroll',
  })
  @ApiOkResponse({ type: ProductListResponseDto })
  listProducts(@Query() query: ListProductsQueryDto): Promise<ProductListResponseDto> {
    return this.catalog.listProducts(query);
  }
}
