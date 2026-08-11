import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { SizeChartService } from './size-chart.service';
import type { CreateSizeEnquiryDto, SizeEnquiryResponseDto } from '../dto/create-size-enquiry.dto';
import type { ProductDetailDto } from '../dto/product-detail.dto';
import type { ListReviewsQueryDto, ReviewListResponseDto } from '../dto/review.dto';
import { FitTag, MediaProvenance } from '../../../common/enums/domain.enums';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor.util';
import type { Env } from '../../../config/env.validation';
import { MediaAsset } from '../../../database/entities/media-asset.entity';
import { Product } from '../../../database/entities/product.entity';
import { ProductVariant } from '../../../database/entities/product-variant.entity';
import { Review } from '../../../database/entities/review.entity';
import { SizeEnquiry } from '../../../database/entities/size-enquiry.entity';

/**
 * The PRD caps the official gallery at 5 items on upload; the read side does not
 * re-impose that, so an admin who legitimately adds a 6th is not silently
 * truncated. Buyer media *is* capped — it grows without bound and the detail
 * response is not the place to page through it, the reviews feed is.
 */
const BUYER_MEDIA_PREVIEW_LIMIT = 12;

interface ReviewAggregateRow {
  total: string;
  average: string | null;
  rating_1: string;
  rating_2: string;
  rating_3: string;
  rating_4: string;
  rating_5: string;
  runs_small: string;
  true_to_size: string;
  runs_large: string;
}

@Injectable()
export class PdpService {
  constructor(
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductVariant) private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(MediaAsset) private readonly mediaRepo: Repository<MediaAsset>,
    @InjectRepository(Review) private readonly reviewRepo: Repository<Review>,
    @InjectRepository(SizeEnquiry) private readonly enquiryRepo: Repository<SizeEnquiry>,
    private readonly sizeChart: SizeChartService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Assembled from several narrow queries rather than one wide join.
   *
   * A product has ~45 variants and up to ~17 media rows; joining both in a
   * single statement multiplies them into ~765 rows to hydrate five useful
   * objects. These queries are a fixed count regardless of catalogue size —
   * the N+1 that ADR-001 warns about is per-row lazy loading, not a handful of
   * deliberate round trips.
   */
  async getProductDetail(slug: string): Promise<ProductDetailDto> {
    const product = await this.productRepo
      .createQueryBuilder('product')
      .innerJoinAndSelect('product.category', 'category')
      .innerJoinAndSelect('product.brand', 'brand')
      .where('product.slug = :slug', { slug })
      .andWhere('product.isActive = true')
      .getOne();

    if (!product) {
      throw new NotFoundException(`Product "${slug}" not found`);
    }

    const [variants, officialMedia, buyerMedia, reviewSummary] = await Promise.all([
      this.variantRepo.find({
        where: { productId: product.id, isActive: true },
        order: { nominalSize: 'ASC', colour: 'ASC' },
      }),
      this.mediaRepo.find({
        where: { productId: product.id, provenance: MediaProvenance.ADMIN },
        order: { displayOrder: 'ASC', createdAt: 'ASC' },
      }),
      this.mediaRepo.find({
        where: { productId: product.id, provenance: MediaProvenance.BUYER },
        order: { createdAt: 'DESC' },
        take: BUYER_MEDIA_PREVIEW_LIMIT,
      }),
      this.getReviewSummary(product.id),
    ]);

    // Only sizes/colours that can actually be bought become selector chips —
    // offering a chip that resolves to zero stock is a dead end mid-purchase.
    const inStock = variants.filter((v) => v.stockQuantity > 0);

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      pricePaise: product.pricePaise,
      compareAtPricePaise: product.compareAtPricePaise,
      fabricType: product.fabricType,
      printTechnique: product.printTechnique,
      category: { slug: product.category.slug, name: product.category.name },
      brand: { slug: product.brand.slug, name: product.brand.name },
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        nominalSize: v.nominalSize,
        colour: v.colour,
        pricePaise: v.pricePaise ?? product.pricePaise,
        stockQuantity: v.stockQuantity,
        inStock: v.stockQuantity > 0,
      })),
      availableSizes: [...new Set(inStock.map((v) => v.nominalSize))].sort((a, b) => a - b),
      availableColours: [...new Set(inStock.map((v) => v.colour))].sort(),
      officialMedia: officialMedia.map((m) => this.toMediaItem(m)),
      buyerMedia: buyerMedia.map((m) => this.toMediaItem(m)),
      sizeChart: this.sizeChart.render(product),
      reviewSummary,
    };
  }

  async listReviews(slug: string, query: ListReviewsQueryDto): Promise<ReviewListResponseDto> {
    const qb = this.reviewRepo
      .createQueryBuilder('review')
      .innerJoin('review.product', 'product')
      .leftJoin('review.user', 'user')
      .select([
        'review.id',
        'review.rating',
        'review.body',
        'review.fitTag',
        'review.purchasedNominalSize',
        'review.isVerifiedPurchase',
        'review.createdAt',
        'user.fullName',
      ])
      .where('product.slug = :slug', { slug })
      .andWhere('product.isActive = true');

    if (query.fitTag) {
      qb.andWhere('review.fitTag = :fitTag', { fitTag: query.fitTag });
    }

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      qb.andWhere(
        '(review.created_at < :cursorValue) OR (review.created_at = :cursorValue AND review.id < :cursorId)',
        { cursorValue: cursor.sortValue, cursorId: cursor.id },
      );
    }

    // Newest first, with id as the tie-breaker so two reviews written in the
    // same millisecond cannot both sit on the cursor boundary and repeat.
    qb.orderBy('review.created_at', 'DESC').addOrderBy('review.id', 'DESC');
    qb.take(query.limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    // Buyer photos fetched separately and grouped in memory: joining them onto
    // the review query would multiply rows and break `take`'s page size.
    const mediaByReview = await this.getMediaByReview(page.map((r) => r.id));

    return {
      items: page.map((r) => ({
        id: r.id,
        rating: r.rating,
        body: r.body,
        fitTag: r.fitTag,
        purchasedNominalSize: r.purchasedNominalSize,
        isVerifiedPurchase: r.isVerifiedPurchase,
        reviewerName: r.user?.fullName ?? null,
        createdAt: r.createdAt.toISOString(),
        media: (mediaByReview.get(r.id) ?? []).map((m) => this.toMediaItem(m)),
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ sortValue: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * The fallback path when the size chart tells a buyer nothing fits.
   *
   * Deliberately open to unauthenticated visitors: requiring a login here would
   * lose exactly the buyer the chart just failed, and the enquiry carries its
   * own contact phone. `userId` stays null until the auth module lands and can
   * supply the caller's identity — the column is nullable for that reason.
   */
  async createSizeEnquiry(
    slug: string,
    dto: CreateSizeEnquiryDto,
  ): Promise<SizeEnquiryResponseDto> {
    const product = await this.productRepo.findOne({
      where: { slug, isActive: true },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException(`Product "${slug}" not found`);
    }

    const enquiry = await this.enquiryRepo.save(
      this.enquiryRepo.create({
        productId: product.id,
        userId: null,
        requestedSize: dto.requestedSize,
        contactPhone: dto.contactPhone,
        message: dto.message ?? null,
      }),
    );

    return {
      id: enquiry.id,
      requestedSize: enquiry.requestedSize,
      status: enquiry.status,
      createdAt: enquiry.createdAt.toISOString(),
    };
  }

  /**
   * One aggregate pass with FILTER clauses rather than a query per bucket —
   * the rating histogram and fit-tag tallies are both read on every PDP load.
   */
  private async getReviewSummary(productId: string): Promise<ProductDetailDto['reviewSummary']> {
    const row = await this.reviewRepo
      .createQueryBuilder('review')
      .select('COUNT(*)', 'total')
      .addSelect('AVG(review.rating)', 'average')
      .addSelect('COUNT(*) FILTER (WHERE review.rating = 1)', 'rating_1')
      .addSelect('COUNT(*) FILTER (WHERE review.rating = 2)', 'rating_2')
      .addSelect('COUNT(*) FILTER (WHERE review.rating = 3)', 'rating_3')
      .addSelect('COUNT(*) FILTER (WHERE review.rating = 4)', 'rating_4')
      .addSelect('COUNT(*) FILTER (WHERE review.rating = 5)', 'rating_5')
      .addSelect(`COUNT(*) FILTER (WHERE review.fit_tag = 'RUNS_SMALL')`, 'runs_small')
      .addSelect(`COUNT(*) FILTER (WHERE review.fit_tag = 'TRUE_TO_SIZE')`, 'true_to_size')
      .addSelect(`COUNT(*) FILTER (WHERE review.fit_tag = 'RUNS_LARGE')`, 'runs_large')
      .where('review.productId = :productId', { productId })
      .getRawOne<ReviewAggregateRow>();

    const total = Number(row?.total ?? 0);

    return {
      totalCount: total,
      // Rounded to one decimal — the client renders "4.3", and an unrounded
      // 4.333333333333333 in the contract invites clients to round differently.
      averageRating:
        total > 0 && row?.average ? Math.round(Number(row.average) * 10) / 10 : null,
      ratingCounts: {
        '1': Number(row?.rating_1 ?? 0),
        '2': Number(row?.rating_2 ?? 0),
        '3': Number(row?.rating_3 ?? 0),
        '4': Number(row?.rating_4 ?? 0),
        '5': Number(row?.rating_5 ?? 0),
      },
      fitTagCounts: {
        [FitTag.RUNS_SMALL]: Number(row?.runs_small ?? 0),
        [FitTag.TRUE_TO_SIZE]: Number(row?.true_to_size ?? 0),
        [FitTag.RUNS_LARGE]: Number(row?.runs_large ?? 0),
      },
    };
  }

  private async getMediaByReview(reviewIds: string[]): Promise<Map<string, MediaAsset[]>> {
    const grouped = new Map<string, MediaAsset[]>();
    if (reviewIds.length === 0) {
      return grouped;
    }

    const assets = await this.mediaRepo.find({
      where: { reviewId: In(reviewIds) },
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });

    for (const asset of assets) {
      if (!asset.reviewId) {
        continue;
      }
      const existing = grouped.get(asset.reviewId);
      if (existing) {
        existing.push(asset);
      } else {
        grouped.set(asset.reviewId, [asset]);
      }
    }

    return grouped;
  }

  private toMediaItem(asset: MediaAsset): ProductDetailDto['officialMedia'][number] {
    const base = this.config.get('R2_PUBLIC_BASE_URL', { infer: true });
    return {
      id: asset.id,
      url: `${base.replace(/\/$/, '')}/${asset.objectKey}`,
      type: asset.type,
      altText: asset.altText,
      isOfficial: asset.provenance === MediaProvenance.ADMIN,
    };
  }
}
