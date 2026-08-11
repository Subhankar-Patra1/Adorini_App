import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PdpService } from './pdp.service';
import { SizeChartService } from './size-chart.service';
import {
  FabricType,
  FitTag,
  MediaProvenance,
  MediaType,
  PrintTechnique,
  SizeEnquiryStatus,
} from '../../../common/enums/domain.enums';
import { encodeCursor } from '../../../common/pagination/cursor.util';
import { MediaAsset } from '../../../database/entities/media-asset.entity';
import { Product } from '../../../database/entities/product.entity';
import { ProductVariant } from '../../../database/entities/product-variant.entity';
import { Review } from '../../../database/entities/review.entity';
import { SizeEnquiry } from '../../../database/entities/size-enquiry.entity';
import type { CreateSizeEnquiryDto } from '../dto/create-size-enquiry.dto';
import type { ListReviewsQueryDto } from '../dto/review.dto';

function buildQb(overrides: Record<string, unknown> = {}) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    'innerJoin',
    'innerJoinAndSelect',
    'leftJoin',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'take',
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getOne = jest.fn();
  qb.getMany = jest.fn();
  qb.getRawOne = jest.fn();
  Object.assign(qb, overrides);
  return qb;
}

const EMPTY_AGGREGATE = {
  total: '0',
  average: null,
  rating_1: '0',
  rating_2: '0',
  rating_3: '0',
  rating_4: '0',
  rating_5: '0',
  runs_small: '0',
  true_to_size: '0',
  runs_large: '0',
};

function productFixture(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    slug: 'ajrak-viscose-stretch-kurti',
    name: 'Ajrak Viscose Stretch Kurti',
    description: 'Ajrak print on stretch viscose.',
    pricePaise: 74900,
    compareAtPricePaise: 99900,
    fabricType: FabricType.STRETCH,
    printTechnique: PrintTechnique.AJRAK,
    sizeRules: null,
    category: { slug: 'kurtis', name: 'Kurtis' },
    brand: { slug: 'mg', name: 'mg' },
    ...overrides,
  } as unknown as Product;
}

describe('PdpService', () => {
  let service: PdpService;
  let productQb: ReturnType<typeof buildQb>;
  let reviewQb: ReturnType<typeof buildQb>;
  let productRepo: { createQueryBuilder: jest.Mock; findOne: jest.Mock };
  let variantRepo: { find: jest.Mock };
  let mediaRepo: { find: jest.Mock };
  let reviewRepo: { createQueryBuilder: jest.Mock };
  let enquiryRepo: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    productQb = buildQb();
    reviewQb = buildQb();
    reviewQb.getRawOne.mockResolvedValue(EMPTY_AGGREGATE);

    productRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(productQb),
      findOne: jest.fn(),
    };
    variantRepo = { find: jest.fn().mockResolvedValue([]) };
    mediaRepo = { find: jest.fn().mockResolvedValue([]) };
    reviewRepo = { createQueryBuilder: jest.fn().mockReturnValue(reviewQb) };
    enquiryRepo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdpService,
        SizeChartService,
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(ProductVariant), useValue: variantRepo },
        { provide: getRepositoryToken(MediaAsset), useValue: mediaRepo },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        { provide: getRepositoryToken(SizeEnquiry), useValue: enquiryRepo },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://cdn.example.com') },
        },
      ],
    }).compile();

    service = module.get(PdpService);
  });

  describe('getProductDetail', () => {
    it('throws NotFound for an unknown or inactive product', async () => {
      productQb.getOne.mockResolvedValue(null);

      await expect(service.getProductDetail('nope')).rejects.toThrow(NotFoundException);
    });

    it('splits official and buyer media into separate badged arrays', async () => {
      productQb.getOne.mockResolvedValue(productFixture());
      mediaRepo.find
        .mockResolvedValueOnce([
          {
            id: 'm1',
            objectKey: 'official/front.jpg',
            type: MediaType.IMAGE,
            altText: 'Front',
            provenance: MediaProvenance.ADMIN,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'm2',
            objectKey: 'buyer/photo.jpg',
            type: MediaType.IMAGE,
            altText: null,
            provenance: MediaProvenance.BUYER,
          },
        ]);

      const detail = await service.getProductDetail('ajrak-viscose-stretch-kurti');

      expect(detail.officialMedia).toEqual([
        {
          id: 'm1',
          url: 'https://cdn.example.com/official/front.jpg',
          type: MediaType.IMAGE,
          altText: 'Front',
          isOfficial: true,
        },
      ]);
      expect(detail.buyerMedia).toEqual([
        {
          id: 'm2',
          url: 'https://cdn.example.com/buyer/photo.jpg',
          type: MediaType.IMAGE,
          altText: null,
          isOfficial: false,
        },
      ]);
    });

    it('queries admin and buyer media by provenance', async () => {
      productQb.getOne.mockResolvedValue(productFixture());

      await service.getProductDetail('ajrak-viscose-stretch-kurti');

      expect(mediaRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: 'prod-1', provenance: MediaProvenance.ADMIN },
        }),
      );
      expect(mediaRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: 'prod-1', provenance: MediaProvenance.BUYER },
        }),
      );
    });

    it('resolves the effective variant price, falling back to the product price', async () => {
      productQb.getOne.mockResolvedValue(productFixture());
      variantRepo.find.mockResolvedValue([
        { id: 'v1', sku: 'A-40', nominalSize: 40, colour: 'Teal', pricePaise: null, stockQuantity: 5 },
        { id: 'v2', sku: 'A-42', nominalSize: 42, colour: 'Teal', pricePaise: 82900, stockQuantity: 2 },
      ]);

      const detail = await service.getProductDetail('ajrak-viscose-stretch-kurti');

      expect(detail.variants[0].pricePaise).toBe(74900);
      expect(detail.variants[1].pricePaise).toBe(82900);
    });

    it('offers only in-stock sizes and colours as selector chips', async () => {
      productQb.getOne.mockResolvedValue(productFixture());
      variantRepo.find.mockResolvedValue([
        { id: 'v1', sku: 'A-40-T', nominalSize: 40, colour: 'Teal', pricePaise: null, stockQuantity: 5 },
        { id: 'v2', sku: 'A-42-M', nominalSize: 42, colour: 'Maroon', pricePaise: null, stockQuantity: 0 },
        { id: 'v3', sku: 'A-44-T', nominalSize: 44, colour: 'Teal', pricePaise: null, stockQuantity: 3 },
      ]);

      const detail = await service.getProductDetail('ajrak-viscose-stretch-kurti');

      expect(detail.availableSizes).toEqual([40, 44]);
      expect(detail.availableColours).toEqual(['Teal']);
      expect(detail.variants.find((v) => v.sku === 'A-42-M')?.inStock).toBe(false);
    });

    it('summarises ratings and fit tags, rounding the average to one decimal', async () => {
      productQb.getOne.mockResolvedValue(productFixture());
      reviewQb.getRawOne.mockResolvedValue({
        total: '3',
        average: '4.333333333333333',
        rating_1: '0',
        rating_2: '0',
        rating_3: '1',
        rating_4: '0',
        rating_5: '2',
        runs_small: '2',
        true_to_size: '1',
        runs_large: '0',
      });

      const detail = await service.getProductDetail('ajrak-viscose-stretch-kurti');

      expect(detail.reviewSummary.totalCount).toBe(3);
      expect(detail.reviewSummary.averageRating).toBe(4.3);
      expect(detail.reviewSummary.ratingCounts).toEqual({
        '1': 0,
        '2': 0,
        '3': 1,
        '4': 0,
        '5': 2,
      });
      expect(detail.reviewSummary.fitTagCounts).toEqual({
        [FitTag.RUNS_SMALL]: 2,
        [FitTag.TRUE_TO_SIZE]: 1,
        [FitTag.RUNS_LARGE]: 0,
      });
    });

    it('reports a null average rating when there are no reviews', async () => {
      productQb.getOne.mockResolvedValue(productFixture());

      const detail = await service.getProductDetail('ajrak-viscose-stretch-kurti');

      expect(detail.reviewSummary.totalCount).toBe(0);
      expect(detail.reviewSummary.averageRating).toBeNull();
    });

    it('returns a null size chart when the product has no rules', async () => {
      productQb.getOne.mockResolvedValue(productFixture({ sizeRules: null }));

      const detail = await service.getProductDetail('ajrak-viscose-stretch-kurti');

      expect(detail.sizeChart).toBeNull();
    });
  });

  describe('listReviews', () => {
    const query = (overrides: Partial<ListReviewsQueryDto> = {}): ListReviewsQueryDto =>
      ({ limit: 2, ...overrides }) as ListReviewsQueryDto;

    function reviewFixture(id: string, createdAt: string) {
      return {
        id,
        rating: 5,
        body: 'Lovely print',
        fitTag: FitTag.TRUE_TO_SIZE,
        purchasedNominalSize: 42,
        isVerifiedPurchase: true,
        createdAt: new Date(createdAt),
        user: { fullName: 'Asha' },
      };
    }

    it('maps reviews and attaches buyer photos fetched in a second query', async () => {
      reviewQb.getMany.mockResolvedValue([reviewFixture('r1', '2026-08-01T00:00:00.000Z')]);
      mediaRepo.find.mockResolvedValue([
        {
          id: 'm1',
          reviewId: 'r1',
          objectKey: 'buyer/r1.jpg',
          type: MediaType.IMAGE,
          altText: null,
          provenance: MediaProvenance.BUYER,
        },
      ]);

      const result = await service.listReviews('slug', query());

      expect(result.items[0].reviewerName).toBe('Asha');
      expect(result.items[0].media).toEqual([
        {
          id: 'm1',
          url: 'https://cdn.example.com/buyer/r1.jpg',
          type: MediaType.IMAGE,
          altText: null,
          isOfficial: false,
        },
      ]);
      expect(result.nextCursor).toBeNull();
    });

    it('skips the media query entirely when there are no reviews', async () => {
      reviewQb.getMany.mockResolvedValue([]);

      const result = await service.listReviews('slug', query());

      expect(result.items).toEqual([]);
      expect(mediaRepo.find).not.toHaveBeenCalled();
    });

    it('reports a null reviewer name when the buyer never set one', async () => {
      reviewQb.getMany.mockResolvedValue([
        { ...reviewFixture('r1', '2026-08-01T00:00:00.000Z'), user: null },
      ]);

      const result = await service.listReviews('slug', query());

      expect(result.items[0].reviewerName).toBeNull();
    });

    it('trims to the page size and encodes a cursor from the last kept review', async () => {
      reviewQb.getMany.mockResolvedValue([
        reviewFixture('r1', '2026-08-03T00:00:00.000Z'),
        reviewFixture('r2', '2026-08-02T00:00:00.000Z'),
        reviewFixture('r3', '2026-08-01T00:00:00.000Z'),
      ]);

      const result = await service.listReviews('slug', query({ limit: 2 }));

      expect(result.items.map((r) => r.id)).toEqual(['r1', 'r2']);
      expect(result.nextCursor).toBe(
        encodeCursor({ sortValue: '2026-08-02T00:00:00.000Z', id: 'r2' }),
      );
    });

    it('filters by fit tag when asked', async () => {
      reviewQb.getMany.mockResolvedValue([]);

      await service.listReviews('slug', query({ fitTag: FitTag.RUNS_SMALL }));

      expect(reviewQb.andWhere).toHaveBeenCalledWith('review.fitTag = :fitTag', {
        fitTag: FitTag.RUNS_SMALL,
      });
    });

    it('rejects a malformed cursor', async () => {
      await expect(service.listReviews('slug', query({ cursor: 'garbage' }))).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createSizeEnquiry', () => {
    const dto: CreateSizeEnquiryDto = {
      requestedSize: '50',
      contactPhone: '919876543210',
      message: 'Need a longer kurti',
    };

    it('throws NotFound when the product does not exist', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await expect(service.createSizeEnquiry('nope', dto)).rejects.toThrow(NotFoundException);
    });

    it('persists an anonymous enquiry until auth can supply a user', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'prod-1' });
      enquiryRepo.save.mockResolvedValue({
        id: 'enq-1',
        requestedSize: '50',
        status: SizeEnquiryStatus.OPEN,
        createdAt: new Date('2026-08-12T00:00:00.000Z'),
      });

      const result = await service.createSizeEnquiry('ajrak-viscose-stretch-kurti', dto);

      expect(enquiryRepo.create).toHaveBeenCalledWith({
        productId: 'prod-1',
        userId: null,
        requestedSize: '50',
        contactPhone: '919876543210',
        message: 'Need a longer kurti',
      });
      expect(result).toEqual({
        id: 'enq-1',
        requestedSize: '50',
        status: SizeEnquiryStatus.OPEN,
        createdAt: '2026-08-12T00:00:00.000Z',
      });
    });

    it('stores a null message when none was supplied', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'prod-1' });
      enquiryRepo.save.mockResolvedValue({
        id: 'enq-2',
        requestedSize: '50',
        status: SizeEnquiryStatus.OPEN,
        createdAt: new Date('2026-08-12T00:00:00.000Z'),
      });

      await service.createSizeEnquiry('slug', { requestedSize: '50', contactPhone: '919876543210' });

      expect(enquiryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: null }),
      );
    });
  });
});
