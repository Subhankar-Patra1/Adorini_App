import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor.util';
import type { BrandDto } from '../dto/brand.dto';
import type { CategoryDto } from '../dto/category.dto';
import type { CatalogSort, ListProductsQueryDto } from '../dto/list-products-query.dto';
import type { ProductListResponseDto } from '../dto/product-summary.dto';
import type {
  SearchSuggestionsResponseDto,
  SuggestQueryDto,
} from '../dto/search-suggestion.dto';
import { Brand } from '../../../database/entities/brand.entity';
import { Category } from '../../../database/entities/category.entity';
import { Product } from '../../../database/entities/product.entity';
import { SearchQuery } from '../../../database/entities/search-query.entity';
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

/**
 * Builds a tsquery whose final term is a prefix match.
 *
 * `plainto_tsquery` only matches whole words, so a shopper who had typed
 * "kurt" got nothing until the moment they completed "kurti" — fatal for a
 * search-as-you-type field, where every query is a prefix until the last
 * keystroke. Only the last term gets `:*`; earlier ones are complete words the
 * shopper has already finished typing.
 *
 * Input is tokenised on non-alphanumerics rather than escaped, because
 * `to_tsquery` parses its argument as an expression: an unescaped `&`, `!` or a
 * stray quote is a syntax error, and a 500 on a search box is not acceptable.
 * Stripping to letters and digits (Unicode-aware, so Bengali and Devanagari
 * survive) leaves nothing for the parser to choke on.
 *
 * Returns null when nothing searchable remains.
 */
export function toPrefixTsQuery(raw: string): string | null {
  // `\p{M}` matters as much as `\p{L}` here: in Bengali and Devanagari the
  // vowel signs and virama are combining *marks*, not letters, so omitting the
  // class shredded কুর্তা into three unrelated consonants and searched for
  // those. Indic script is real product text in this catalogue.
  const terms = raw
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((term) => term.length > 0);

  if (terms.length === 0) {
    return null;
  }

  return terms
    .map((term, index) => (index === terms.length - 1 ? `${term}:*` : term))
    .join(' & ');
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Category) private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Brand) private readonly brandRepo: Repository<Brand>,
    @InjectRepository(SearchQuery)
    private readonly searchQueryRepo: Repository<SearchQuery>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private readonly logger = new Logger(CatalogService.name);

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
      // search_vector is DB-trigger-maintained (see migrations
      // AddProductSearchVector and WidenProductSearchVector) and intentionally
      // not a mapped entity column.
      const tsquery = toPrefixTsQuery(query.q);
      // A query of only punctuation leaves nothing to search for. Matching
      // everything would be worse than matching nothing: the shopper typed
      // something, and a full catalogue back implies it was found.
      if (tsquery === null) {
        return { items: [], nextCursor: null };
      }
      qb.andWhere(`product.search_vector @@ to_tsquery('english', :q)`, { q: tsquery });
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

    // Log the search for merchandising. Only the first page: infinite scroll
    // re-issues the same query with a cursor, and counting those would report
    // one shopper scrolling as several people searching.
    if (query.q && !query.cursor) {
      this.recordSearch(query.q, page.length);
    }

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

  /**
   * Fire-and-forget: analytics must never break browsing.
   *
   * Deliberately not awaited, and it swallows its own errors. A full disk or a
   * lock on this table would otherwise turn every search into a 500 - trading
   * the storefront for a report nobody is reading in real time.
   */
  private recordSearch(term: string, resultCount: number): void {
    const trimmed = term.trim().slice(0, 120);
    if (trimmed.length === 0) {
      return;
    }

    void this.searchQueryRepo
      .insert({
        term: trimmed,
        normalisedTerm: trimmed.toLowerCase().replace(/\s+/g, ' '),
        resultCount,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to record search analytics for "${trimmed}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /**
   * Type-ahead suggestions: what to *offer*, not what to show.
   *
   * Ordered category, then brand, then product. A shopper three letters into a
   * word is usually still narrowing - "kurt" means "show me kurtis", not "show
   * me this one kurti" - so the broad destinations come first and the specific
   * products fill whatever room is left.
   *
   * Matching is `ILIKE`, not the tsvector: the index is stemmed and weighted
   * for relevance across a whole document, which is right for ranking results
   * and wrong for completing a word. Suggestions must match the letters on
   * screen, or the list appears to disagree with what was typed.
   */
  async suggest(query: SuggestQueryDto): Promise<SearchSuggestionsResponseDto> {
    const pattern = `%${query.q.trim().replace(/[%_]/g, '\\$&')}%`;

    const [categories, brands, products] = await Promise.all([
      this.categoryRepo
        .createQueryBuilder('category')
        .where('category.isActive = true')
        .andWhere('category.name ILIKE :pattern', { pattern })
        .orderBy('category.displayOrder', 'ASC')
        .take(query.limit)
        .getMany(),
      this.brandRepo
        .createQueryBuilder('brand')
        .where('brand.isActive = true')
        .andWhere('brand.name ILIKE :pattern', { pattern })
        .orderBy('brand.displayOrder', 'ASC')
        .take(query.limit)
        .getMany(),
      this.productRepo
        .createQueryBuilder('product')
        .innerJoin('product.category', 'category', 'category.isActive = true')
        .where('product.isActive = true')
        .andWhere('product.name ILIKE :pattern', { pattern })
        .orderBy('product.name', 'ASC')
        .take(query.limit)
        .getMany(),
    ]);

    const items = [
      ...categories.map((c) => ({ kind: 'CATEGORY' as const, label: c.name, slug: c.slug })),
      ...brands.map((b) => ({ kind: 'BRAND' as const, label: b.name, slug: b.slug })),
      ...products.map((p) => ({ kind: 'PRODUCT' as const, label: p.name, slug: p.slug })),
    ].slice(0, query.limit);

    return { items };
  }
}
