import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CatalogService, toPrefixTsQuery } from './catalog.service';
import { SearchQuery } from '../../../database/entities/search-query.entity';
import { encodeCursor } from '../../../common/pagination/cursor.util';
import { Brand } from '../../../database/entities/brand.entity';
import { Category } from '../../../database/entities/category.entity';
import { Product } from '../../../database/entities/product.entity';
import { FabricType, PrintTechnique } from '../../../common/enums/domain.enums';
import type { ListProductsQueryDto } from '../dto/list-products-query.dto';

type QueryBuilderMock = {
  innerJoin: jest.Mock;
  leftJoin: jest.Mock;
  select: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
};

function buildQueryBuilderMock(): QueryBuilderMock {
  const qb = {} as QueryBuilderMock;
  qb.innerJoin = jest.fn().mockReturnValue(qb);
  qb.leftJoin = jest.fn().mockReturnValue(qb);
  qb.select = jest.fn().mockReturnValue(qb);
  qb.where = jest.fn().mockReturnValue(qb);
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn().mockReturnValue(qb);
  qb.addOrderBy = jest.fn().mockReturnValue(qb);
  qb.take = jest.fn().mockReturnValue(qb);
  qb.getMany = jest.fn();
  return qb;
}

function baseQuery(overrides: Partial<ListProductsQueryDto> = {}): ListProductsQueryDto {
  return { sort: 'newest', limit: 2, ...overrides };
}

function productFixture(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'kalankari-cotton-straight-kurti',
    name: 'Kalankari Cotton Straight Kurti',
    pricePaise: 89900,
    compareAtPricePaise: 129900,
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.KALANKARI,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    category: { slug: 'kurtis' },
    brand: { slug: 'sana' },
    media: [],
    ...overrides,
  } as unknown as Product;
}

describe('CatalogService', () => {
  let service: CatalogService;
  let productQb: QueryBuilderMock;
  let categoryRepo: { find: jest.Mock };
  let brandRepo: { find: jest.Mock };
  let searchQueryRepo: { insert: jest.Mock };

  beforeEach(async () => {
    productQb = buildQueryBuilderMock();
    categoryRepo = { find: jest.fn() };
    brandRepo = { find: jest.fn() };
    searchQueryRepo = { insert: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        {
          provide: getRepositoryToken(Product),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(productQb) },
        },
        { provide: getRepositoryToken(Category), useValue: categoryRepo },
        { provide: getRepositoryToken(Brand), useValue: brandRepo },
        // Analytics writes are fire-and-forget, so the double only has to
        // resolve; a rejection here must not fail a search, which is asserted
        // separately below.
        { provide: getRepositoryToken(SearchQuery), useValue: searchQueryRepo },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://cdn.example.com') },
        },
      ],
    }).compile();

    service = module.get(CatalogService);
  });

  describe('listCategories', () => {
    it('maps active categories ordered by display order', async () => {
      categoryRepo.find.mockResolvedValue([
        { slug: 'kurtis', name: 'Kurtis', description: null, displayOrder: 1 },
      ]);

      const result = await service.listCategories();

      expect(categoryRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { displayOrder: 'ASC' },
      });
      expect(result).toEqual([
        { slug: 'kurtis', name: 'Kurtis', description: null, displayOrder: 1 },
      ]);
    });
  });

  describe('listBrands', () => {
    it('composes a public logo URL from the R2 object key', async () => {
      brandRepo.find.mockResolvedValue([
        { slug: 'sana', name: 'sana', logoKey: 'brands/sana.png', displayOrder: 1 },
      ]);

      const result = await service.listBrands();

      expect(result).toEqual([
        {
          slug: 'sana',
          name: 'sana',
          logoUrl: 'https://cdn.example.com/brands/sana.png',
          displayOrder: 1,
        },
      ]);
    });

    it('returns a null logo URL when no logo key is set', async () => {
      brandRepo.find.mockResolvedValue([
        { slug: 'mg', name: 'mg', logoKey: null, displayOrder: 2 },
      ]);

      const result = await service.listBrands();

      expect(result[0].logoUrl).toBeNull();
    });
  });

  describe('listProducts', () => {
    it('maps rows to summaries and resolves the thumbnail URL', async () => {
      productQb.getMany.mockResolvedValue([
        productFixture({ media: [{ objectKey: 'products/kurti.jpg' } as never] }),
      ]);

      const result = await service.listProducts(baseQuery());

      expect(result.items).toEqual([
        {
          id: 'p1',
          slug: 'kalankari-cotton-straight-kurti',
          name: 'Kalankari Cotton Straight Kurti',
          pricePaise: 89900,
          compareAtPricePaise: 129900,
          fabricType: FabricType.RIGID,
          printTechnique: PrintTechnique.KALANKARI,
          categorySlug: 'kurtis',
          brandSlug: 'sana',
          thumbnailUrl: 'https://cdn.example.com/products/kurti.jpg',
        },
      ]);
      expect(result.nextCursor).toBeNull();
    });

    it('returns null thumbnail when no admin media exists', async () => {
      productQb.getMany.mockResolvedValue([productFixture({ media: [] })]);

      const result = await service.listProducts(baseQuery());

      expect(result.items[0].thumbnailUrl).toBeNull();
    });

    it('signals a next page and encodes a cursor when more rows exist than the limit', async () => {
      productQb.getMany.mockResolvedValue([
        productFixture({ id: 'p1', createdAt: new Date('2026-08-03T00:00:00.000Z') }),
        productFixture({ id: 'p2', createdAt: new Date('2026-08-02T00:00:00.000Z') }),
        productFixture({ id: 'p3', createdAt: new Date('2026-08-01T00:00:00.000Z') }),
      ]);

      const result = await service.listProducts(baseQuery({ limit: 2 }));

      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.id)).toEqual(['p1', 'p2']);
      expect(result.nextCursor).toEqual(
        encodeCursor({ sortValue: '2026-08-02T00:00:00.000Z', id: 'p2' }),
      );
    });

    it('applies a seek predicate derived from a decoded cursor', async () => {
      productQb.getMany.mockResolvedValue([]);
      const cursor = encodeCursor({ sortValue: '2026-08-01T00:00:00.000Z', id: 'p9' });

      await service.listProducts(baseQuery({ cursor }));

      expect(productQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('product.created_at'),
        { cursorValue: '2026-08-01T00:00:00.000Z', cursorId: 'p9' },
      );
    });

    it('rejects a malformed cursor', async () => {
      await expect(service.listProducts(baseQuery({ cursor: 'not-base64-json' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('filters by category, brand, fabric, print technique and price range', async () => {
      productQb.getMany.mockResolvedValue([]);

      await service.listProducts(
        baseQuery({
          category: 'kurtis',
          brand: 'sana',
          fabricType: FabricType.RIGID,
          printTechnique: PrintTechnique.KALANKARI,
          minPrice: 10000,
          maxPrice: 100000,
          size: 42,
          q: 'kurti',
        }),
      );

      expect(productQb.andWhere).toHaveBeenCalledWith('category.slug = :categorySlug', {
        categorySlug: 'kurtis',
      });
      expect(productQb.andWhere).toHaveBeenCalledWith('brand.slug = :brandSlug', {
        brandSlug: 'sana',
      });
      expect(productQb.andWhere).toHaveBeenCalledWith('product.fabricType = :fabricType', {
        fabricType: FabricType.RIGID,
      });
      expect(productQb.andWhere).toHaveBeenCalledWith('product.printTechnique = :printTechnique', {
        printTechnique: PrintTechnique.KALANKARI,
      });
      expect(productQb.andWhere).toHaveBeenCalledWith('product.pricePaise >= :minPrice', {
        minPrice: 10000,
      });
      expect(productQb.andWhere).toHaveBeenCalledWith('product.pricePaise <= :maxPrice', {
        maxPrice: 100000,
      });
      expect(productQb.andWhere).toHaveBeenCalledWith(expect.stringContaining('EXISTS'), {
        size: 42,
      });
      // `kurti:*`, not `kurti` - the last term is a prefix so that a query
      // still matches mid-word while the shopper is typing.
      expect(productQb.andWhere).toHaveBeenCalledWith(expect.stringContaining('search_vector'), {
        q: 'kurti:*',
      });
    });

    describe('search analytics', () => {
      it('records the term and how many products came back', async () => {
        productQb.getMany.mockResolvedValue([productFixture()]);

        await service.listProducts(baseQuery({ q: 'Kurti ' }));

        expect(searchQueryRepo.insert).toHaveBeenCalledWith({
          term: 'Kurti',
          // Lower-cased so the report aggregates spellings into one row.
          normalisedTerm: 'kurti',
          resultCount: 1,
        });
      });

      it('records a zero-result search, which is the point of the table', async () => {
        productQb.getMany.mockResolvedValue([]);

        await service.listProducts(baseQuery({ q: 'saree' }));

        expect(searchQueryRepo.insert).toHaveBeenCalledWith(
          expect.objectContaining({ normalisedTerm: 'saree', resultCount: 0 }),
        );
      });

      it('does not record paging through an existing search', async () => {
        productQb.getMany.mockResolvedValue([productFixture()]);

        await service.listProducts(
          baseQuery({
            q: 'kurti',
            cursor: encodeCursor({ sortValue: '2026-08-03T00:00:00.000Z', id: 'p1' }),
          }),
        );

        // Infinite scroll re-issues the same query with a cursor. Counting
        // those would report one shopper scrolling as several people searching.
        expect(searchQueryRepo.insert).not.toHaveBeenCalled();
      });

      it('does not record a browse with no search term', async () => {
        productQb.getMany.mockResolvedValue([productFixture()]);

        await service.listProducts(baseQuery());

        expect(searchQueryRepo.insert).not.toHaveBeenCalled();
      });

      it('still returns results when recording the search fails', async () => {
        productQb.getMany.mockResolvedValue([productFixture()]);
        searchQueryRepo.insert.mockRejectedValue(new Error('disk full'));

        // Analytics is fire-and-forget: a broken report must never take the
        // storefront down with it.
        await expect(service.listProducts(baseQuery({ q: 'kurti' }))).resolves.toEqual(
          expect.objectContaining({ items: expect.any(Array) }),
        );
      });
    });
  });
});

describe('toPrefixTsQuery', () => {
  it('makes only the final term a prefix', () => {
    expect(toPrefixTsQuery('black kurti')).toBe('black & kurti:*');
  });

  it('prefixes a single term', () => {
    expect(toPrefixTsQuery('kurt')).toBe('kurt:*');
  });

  it('strips tsquery operators that would be a syntax error', () => {
    // `to_tsquery` parses its argument as an expression, so an unescaped
    // operator raises rather than returning no rows - a 500 from a search box.
    expect(toPrefixTsQuery('black & kurti')).toBe('black & kurti:*');
    expect(toPrefixTsQuery("!kurti | 'x'")).toBe('kurti & x:*');
  });

  it('keeps non-Latin scripts, which are real product text here', () => {
    expect(toPrefixTsQuery('\u0995\u09c1\u09b0\u09cd\u09a4\u09be')).toBe('\u0995\u09c1\u09b0\u09cd\u09a4\u09be:*');
  });

  it('returns null when nothing searchable survives', () => {
    expect(toPrefixTsQuery('%%%')).toBeNull();
    expect(toPrefixTsQuery('   ')).toBeNull();
  });
});
