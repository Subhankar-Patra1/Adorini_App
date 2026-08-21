import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AdminCatalogService } from './admin-catalog.service';
import { FabricType, MediaProvenance, MediaType } from '../../../common/enums/domain.enums';
import { Brand } from '../../../database/entities/brand.entity';
import { Category } from '../../../database/entities/category.entity';
import { MediaAsset } from '../../../database/entities/media-asset.entity';
import { Product } from '../../../database/entities/product.entity';
import { ProductVariant } from '../../../database/entities/product-variant.entity';
import { SizeEnquiry } from '../../../database/entities/size-enquiry.entity';
import { StorageService } from '../../../providers/storage/storage.service';
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
  let categoriesFind: jest.Mock;
  let brandsCountBy: jest.Mock;
  let brandsFind: jest.Mock;
  let mediaCountBy: jest.Mock;
  let mediaCreate: jest.Mock;
  let mediaSave: jest.Mock;
  let storageUploadFile: jest.Mock;

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
    categoriesFind = jest.fn().mockResolvedValue([]);
    brandsCountBy = jest.fn().mockResolvedValue(1);
    brandsFind = jest.fn().mockResolvedValue([]);
    mediaCountBy = jest.fn().mockResolvedValue(0);
    mediaCreate = jest.fn().mockImplementation((m: unknown) => m);
    mediaSave = jest
      .fn()
      .mockImplementation((rows: Record<string, unknown>[]) =>
        Promise.resolve(rows.map((r, i) => ({ id: `media-${i}`, ...r }))),
      );
    storageUploadFile = jest.fn().mockResolvedValue('https://media.example.com/uploaded');

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
        {
          provide: getRepositoryToken(Category),
          useValue: { countBy: categoriesCountBy, find: categoriesFind },
        },
        {
          provide: getRepositoryToken(Brand),
          useValue: { countBy: brandsCountBy, find: brandsFind },
        },
        {
          provide: getRepositoryToken(SizeEnquiry),
          useValue: { find: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(MediaAsset),
          useValue: { countBy: mediaCountBy, create: mediaCreate, save: mediaSave },
        },
        { provide: StorageService, useValue: { uploadFile: storageUploadFile } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://media.example.com') },
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

  describe('listCategoriesForAdmin / listBrandsForAdmin', () => {
    it('includes the id and inactive rows, unlike the public catalog read', async () => {
      categoriesFind.mockResolvedValue([
        { id: 'c1', slug: 'kurtis', name: 'Kurti', isActive: true },
        { id: 'c2', slug: 'retired', name: 'Retired', isActive: false },
      ]);

      await expect(service.listCategoriesForAdmin()).resolves.toEqual([
        { id: 'c1', slug: 'kurtis', name: 'Kurti', isActive: true },
        { id: 'c2', slug: 'retired', name: 'Retired', isActive: false },
      ]);
      expect(categoriesFind).toHaveBeenCalledWith({ order: { displayOrder: 'ASC' } });
    });

    it('brands: same shape', async () => {
      brandsFind.mockResolvedValue([
        { id: 'b1', slug: 'navranga', name: 'NAVRANGA', isActive: true },
      ]);

      await expect(service.listBrandsForAdmin()).resolves.toEqual([
        { id: 'b1', slug: 'navranga', name: 'NAVRANGA', isActive: true },
      ]);
    });
  });

  describe('attachProductMedia', () => {
    it('404s when the product does not exist', async () => {
      productsFindOne.mockResolvedValue(null);

      await expect(service.attachProductMedia('missing', [])).rejects.toThrow(NotFoundException);
    });

    it('returns nothing and touches no storage when no files are given', async () => {
      productsFindOne.mockResolvedValue({ id: 'product-1' });

      await expect(service.attachProductMedia('product-1', [])).resolves.toEqual([]);
      expect(storageUploadFile).not.toHaveBeenCalled();
    });

    it('uploads each file and creates an ADMIN-provenance row starting at displayOrder 0', async () => {
      productsFindOne.mockResolvedValue({ id: 'product-1' });
      mediaCountBy.mockResolvedValue(0);

      const files = [
        { buffer: Buffer.from('a'), mimetype: 'image/jpeg' } as Express.Multer.File,
        { buffer: Buffer.from('b'), mimetype: 'image/png' } as Express.Multer.File,
      ];

      const result = await service.attachProductMedia('product-1', files);

      expect(storageUploadFile).toHaveBeenNthCalledWith(
        1,
        'products/product-1/0.jpg',
        files[0].buffer,
        'image/jpeg',
      );
      expect(storageUploadFile).toHaveBeenNthCalledWith(
        2,
        'products/product-1/1.png',
        files[1].buffer,
        'image/png',
      );
      expect(mediaCreate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          productId: 'product-1',
          objectKey: 'products/product-1/0.jpg',
          type: MediaType.IMAGE,
          provenance: MediaProvenance.ADMIN,
          uploadedByUserId: null,
          reviewId: null,
          displayOrder: 0,
        }),
      );
      expect(result).toEqual([
        {
          id: 'media-0',
          url: 'https://media.example.com/products/product-1/0.jpg',
          displayOrder: 0,
        },
        {
          id: 'media-1',
          url: 'https://media.example.com/products/product-1/1.png',
          displayOrder: 1,
        },
      ]);
    });

    it('appends after existing media rather than overwriting displayOrder 0', async () => {
      // A second upload call for the same product must not clobber the
      // catalog thumbnail that CatalogService already reads from
      // displayOrder 0 — only the first-ever image for a product should land there.
      productsFindOne.mockResolvedValue({ id: 'product-1' });
      mediaCountBy.mockResolvedValue(2);

      const files = [{ buffer: Buffer.from('c'), mimetype: 'image/webp' } as Express.Multer.File];

      const result = await service.attachProductMedia('product-1', files);

      expect(storageUploadFile).toHaveBeenCalledWith(
        'products/product-1/2.webp',
        files[0].buffer,
        'image/webp',
      );
      expect(result[0].displayOrder).toBe(2);
    });
  });
});
