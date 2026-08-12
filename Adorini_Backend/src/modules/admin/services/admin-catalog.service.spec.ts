import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AdminCatalogService } from './admin-catalog.service';
import { FabricType } from '../../../common/enums/domain.enums';
import { Brand } from '../../../database/entities/brand.entity';
import { Category } from '../../../database/entities/category.entity';
import { Product } from '../../../database/entities/product.entity';
import { ProductVariant } from '../../../database/entities/product-variant.entity';
import { SizeEnquiry } from '../../../database/entities/size-enquiry.entity';
import type { CreateProductDto } from '../dto/admin.dto';

/** A well-formed rigid chart, matching what the seeds generate. */
function validRigidChart() {
  return {
    fabricType: FabricType.RIGID,
    entries: [
      {
        nominalSize: 42,
        bust: { minCm: 105, maxCm: 109 },
        waist: { minCm: 85, maxCm: 89 },
        hip: { minCm: 108, maxCm: 112 },
        garmentLengthCm: 110,
      },
    ],
    guidanceNote: 'Non-stretch fabric.',
  };
}

describe('AdminCatalogService', () => {
  let service: AdminCatalogService;
  let productsFindOne: jest.Mock;
  let productsSave: jest.Mock;
  let productsCreate: jest.Mock;
  let variantsCountBy: jest.Mock;
  let categoriesCountBy: jest.Mock;
  let brandsCountBy: jest.Mock;

  const baseDto = (): CreateProductDto => ({
    slug: 'test-kurti',
    name: 'Test Kurti',
    categoryId: '00000000-0000-0000-0000-0000000000c1',
    brandId: '00000000-0000-0000-0000-0000000000b1',
    pricePaise: 89_900,
    fabricType: FabricType.RIGID,
    isActive: true,
  });

  beforeEach(async () => {
    productsFindOne = jest.fn();
    productsSave = jest.fn().mockImplementation((p: unknown) =>
      Promise.resolve({
        id: 'product-1',
        ...(p as Record<string, unknown>),
      }),
    );
    productsCreate = jest.fn().mockImplementation((p: unknown) => p);
    variantsCountBy = jest.fn().mockResolvedValue(0);
    categoriesCountBy = jest.fn().mockResolvedValue(1);
    brandsCountBy = jest.fn().mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminCatalogService,
        {
          provide: getRepositoryToken(Product),
          useValue: { findOne: productsFindOne, save: productsSave, create: productsCreate },
        },
        {
          provide: getRepositoryToken(ProductVariant),
          useValue: {
            countBy: variantsCountBy,
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        { provide: getRepositoryToken(Category), useValue: { countBy: categoriesCountBy } },
        { provide: getRepositoryToken(Brand), useValue: { countBy: brandsCountBy } },
        {
          provide: getRepositoryToken(SizeEnquiry),
          useValue: { find: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(AdminCatalogService);
  });

  describe('@GUARD Risk #5 — size_rules validation on write', () => {
    it('accepts a well-formed chart', async () => {
      await expect(
        service.createProduct({ ...baseDto(), sizeRules: validRigidChart() }),
      ).resolves.toMatchObject({ hasSizeChart: true });
    });

    it('accepts a product with no chart at all', async () => {
      await expect(service.createProduct(baseDto())).resolves.toMatchObject({
        hasSizeChart: false,
      });
    });

    it('rejects a reversed measurement range', async () => {
      const chart = validRigidChart();
      chart.entries[0].bust = { minCm: 109, maxCm: 105 };

      await expect(service.createProduct({ ...baseDto(), sizeRules: chart })).rejects.toThrow(
        BadRequestException,
      );
      expect(productsSave).not.toHaveBeenCalled();
    });

    it('rejects a nominal size outside the stocked band', async () => {
      const chart = validRigidChart();
      chart.entries[0].nominalSize = 52;

      await expect(service.createProduct({ ...baseDto(), sizeRules: chart })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a duplicate nominal size', async () => {
      const chart = validRigidChart();
      chart.entries = [chart.entries[0], { ...chart.entries[0] }];

      await expect(service.createProduct({ ...baseDto(), sizeRules: chart })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an empty chart', async () => {
      const chart = { ...validRigidChart(), entries: [] };

      await expect(service.createProduct({ ...baseDto(), sizeRules: chart })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a chart whose fabric contradicts the product', async () => {
      // The one thing the schema cannot catch alone: a stretch chart on a rigid
      // garment validates perfectly and still tells every buyer the wrong size,
      // producing exactly the return this feature exists to prevent.
      const stretchChart = { ...validRigidChart(), fabricType: FabricType.STRETCH };

      await expect(
        service.createProduct({
          ...baseDto(),
          fabricType: FabricType.RIGID,
          sizeRules: stretchChart,
        }),
      ).rejects.toThrow(/STRETCH fabric but the product is RIGID/);
    });

    it('re-validates the existing chart when only the fabric changes', async () => {
      // Otherwise flipping a product to STRETCH would leave its rigid chart in
      // place, silently mismatched.
      productsFindOne.mockResolvedValue({
        id: 'product-1',
        categoryId: 'c1',
        brandId: 'b1',
        fabricType: FabricType.RIGID,
        sizeRules: validRigidChart(),
      });

      await expect(
        service.updateProduct('product-1', { fabricType: FabricType.STRETCH }),
      ).rejects.toThrow(/fabric/i);
    });
  });

  describe('referential checks', () => {
    it('rejects an unknown category', async () => {
      categoriesCountBy.mockResolvedValue(0);

      await expect(service.createProduct(baseDto())).rejects.toThrow(/Unknown category/);
    });

    it('rejects an unknown brand', async () => {
      brandsCountBy.mockResolvedValue(0);

      await expect(service.createProduct(baseDto())).rejects.toThrow(/Unknown brand/);
    });
  });
});
