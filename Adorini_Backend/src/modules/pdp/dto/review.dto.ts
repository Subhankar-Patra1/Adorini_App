import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { mediaItemSchema } from './product-detail.dto';
import { FitTag } from '../../../common/enums/domain.enums';

export const listReviewsQuerySchema = z.object({
  /** Index-backed by `idx_reviews_product_fit_tag` — "show me what buyers who found it tight said". */
  fitTag: z.enum(FitTag).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export class ListReviewsQueryDto extends createZodDto(listReviewsQuerySchema) {}

export const reviewSchema = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  body: z.string().nullable(),
  fitTag: z.enum(FitTag).nullable(),
  purchasedNominalSize: z.number().int().nullable(),
  isVerifiedPurchase: z.boolean(),
  /** Display name as the buyer set it; null when they never set one. */
  reviewerName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  media: z.array(mediaItemSchema),
});

export const reviewListResponseSchema = z.object({
  items: z.array(reviewSchema),
  nextCursor: z.string().nullable(),
});

export class ReviewListResponseDto extends createZodDto(reviewListResponseSchema) {}
