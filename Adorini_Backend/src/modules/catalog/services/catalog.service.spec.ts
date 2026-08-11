import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CatalogService } from './catalog.service';
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
  return { sort: 'newest', limit: 2, ...overrides } as ListProductsQueryDto;
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

  beforeEach(async () => {
    productQb = buildQueryBuilderMock();
    categoryRepo = { find: jest.fn() };
    brandRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        {
          provide: getRepositoryToken(Product),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(productQb) },
        },
        { provide: getRepositoryToken(Category), useValue: categoryRepo },
        { provide: getRepositoryToken(Brand), useValue: brandRepo },
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
      expect(productQb.andWhere).toHaveBeenCalledWith(
        'product.printTechnique = :printTechnique',
        { printTechnique: PrintTechnique.KALANKARI },
      );
      expect(productQb.andWhere).toHaveBeenCalledWith('product.pricePaise >= :minPrice', {
        minPrice: 10000,
      });
      expect(productQb.andWhere).toHaveBeenCalledWith('product.pricePaise <= :maxPrice', {
        maxPrice: 100000,
      });
      expect(productQb.andWhere).toHaveBeenCalledWith(expect.stringContaining('EXISTS'), {
        size: 42,
      });
      expect(productQb.andWhere).toHaveBeenCalledWith(expect.stringContaining('search_vector'), {
        q: 'kurti',
      });
    });
  });
});
