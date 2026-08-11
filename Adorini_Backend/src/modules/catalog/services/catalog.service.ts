import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor.util';
import type { BrandDto } from '../dto/brand.dto';
import type { CategoryDto } from '../dto/category.dto';
import type { CatalogSort, ListProductsQueryDto } from '../dto/list-products-query.dto';
import type { ProductListResponseDto } from '../dto/product-summary.dto';
import { Brand } from '../../../database/entities/brand.entity';
import { Category } from '../../../database/entities/category.entity';
import { Product } from '../../../database/entities/product.entity';
import { MediaProvenance } from '../../../common/enums/domain.enums';
import type { Env } from '../../../config/env.validation';

interface SortStrategy {
  /** Raw (snake_case) column, qualified with the `product` query-builder alias. */
  column: string;
  direction: 'ASC' | 'DESC';
  extractSortValue: (product: Product) => string;
  parseCursorValue: (value: string) => string | number;
}

/**
 * One indexed column per sort mode. `idx_products_category_price` covers
 * price sort within a category filter; `created_at` has no dedicated index
 * yet because "newest" has no category/price predicate to combine it with —
 * revisit if a `(created_at)` index becomes necessary under real traffic.
 */
const SORT_STRATEGIES: Record<CatalogSort, SortStrategy> = {
  newest: {
    column: 'product.created_at',
    direction: 'DESC',
    extractSortValue: (p) => p.createdAt.toISOString(),
    parseCursorValue: (v) => v,
  },
  price_asc: {
    column: 'product.price_paise',
    direction: 'ASC',
    extractSortValue: (p) => String(p.pricePaise),
    parseCursorValue: (v) => Number(v),
  },
  price_desc: {
    column: 'product.price_paise',
    direction: 'DESC',
    extractSortValue: (p) => String(p.pricePaise),
    parseCursorValue: (v) => Number(v),
  },
};

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Category) private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Brand) private readonly brandRepo: Repository<Brand>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async listCategories(): Promise<CategoryDto[]> {
    const rows = await this.categoryRepo.find({
      where: { isActive: true },
      order: { displayOrder: 'ASC' },
    });

    return rows.map((c) => ({
      slug: c.slug,
      name: c.name,
      description: c.description,
      displayOrder: c.displayOrder,
    }));
  }

  async listBrands(): Promise<BrandDto[]> {
    const rows = await this.brandRepo.find({
      where: { isActive: true },
      order: { displayOrder: 'ASC' },
    });

    return rows.map((b) => ({
      slug: b.slug,
      name: b.name,
      logoUrl: b.logoKey ? this.toPublicUrl(b.logoKey) : null,
      displayOrder: b.displayOrder,
    }));
  }

  async listProducts(query: ListProductsQueryDto): Promise<ProductListResponseDto> {
    const strategy = SORT_STRATEGIES[query.sort];

    const qb = this.productRepo
      .createQueryBuilder('product')
      .innerJoin('product.category', 'category')
      .innerJoin('product.brand', 'brand')
      // Assumes the admin-curated primary image is always the displayOrder-0
      // ADMIN asset — true for every product seeded/admin-created so far.
      // Revisit with a proper "first row per group" join if that stops holding.
      .leftJoin(
        'product.media',
        'thumbnail',
        'thumbnail.provenance = :adminProvenance AND thumbnail.displayOrder = 0',
        { adminProvenance: MediaProvenance.ADMIN },
      )
      .select([
        'product.id',
        'product.slug',
        'product.name',
        'product.pricePaise',
        'product.compareAtPricePaise',
        'product.fabricType',
        'product.printTechnique',
        'product.createdAt',
        'category.slug',
        'brand.slug',
        'thumbnail.objectKey',
      ])
      .where('product.isActive = true')
      .andWhere('category.isActive = true')
      .andWhere('brand.isActive = true');

    if (query.category) {
      qb.andWhere('category.slug = :categorySlug', { categorySlug: query.category });
    }
    if (query.brand) {
      qb.andWhere('brand.slug = :brandSlug', { brandSlug: query.brand });
    }
    if (query.fabricType) {
      qb.andWhere('product.fabricType = :fabricType', { fabricType: query.fabricType });
    }
    if (query.printTechnique) {
      qb.andWhere('product.printTechnique = :printTechnique', {
        printTechnique: query.printTechnique,
      });
    }
    if (query.minPrice !== undefined) {
      qb.andWhere('product.pricePaise >= :minPrice', { minPrice: query.minPrice });
    }
    if (query.maxPrice !== undefined) {
      qb.andWhere('product.pricePaise <= :maxPrice', { maxPrice: query.maxPrice });
    }
    if (query.size !== undefined) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM "product_variants" v
          WHERE v.product_id = product.id
            AND v.nominal_size = :size
            AND v.is_active = true
            AND v.stock_quantity > 0
        )`,
        { size: query.size },
      );
    }
    if (query.q) {
      // search_vector is DB-trigger-maintained (see migration
      // AddProductSearchVector) and intentionally not a mapped entity column.
      qb.andWhere(`product.search_vector @@ plainto_tsquery('english', :q)`, { q: query.q });
    }

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      const op = strategy.direction === 'DESC' ? '<' : '>';
      qb.andWhere(
        `(${strategy.column} ${op} :cursorValue) OR (${strategy.column} = :cursorValue AND product.id ${op} :cursorId)`,
        { cursorValue: strategy.parseCursorValue(cursor.sortValue), cursorId: cursor.id },
      );
    }

    qb.orderBy(strategy.column, strategy.direction).addOrderBy('product.id', strategy.direction);

    // Fetch one extra row to know whether a next page exists without a second query.
    qb.take(query.limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        pricePaise: p.pricePaise,
        compareAtPricePaise: p.compareAtPricePaise,
        fabricType: p.fabricType,
        printTechnique: p.printTechnique,
        categorySlug: p.category.slug,
        brandSlug: p.brand.slug,
        thumbnailUrl: p.media?.[0]?.objectKey ? this.toPublicUrl(p.media[0].objectKey) : null,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ sortValue: strategy.extractSortValue(last), id: last.id })
          : null,
    };
  }

  private toPublicUrl(objectKey: string): string {
    const base = this.config.get('R2_PUBLIC_BASE_URL', { infer: true });
    return `${base.replace(/\/$/, '')}/${objectKey}`;
  }
}
