import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { sizeChartSchema } from './size-chart.dto';
import { FabricType, FitTag, MediaType, PrintTechnique } from '../../../common/enums/domain.enums';

/**
 * A gallery item. `isOfficial` is the trust signal the product is built around —
 * it mirrors `MediaAsset.provenance` and is what the client badges. Official and
 * buyer media are returned in separate arrays so a client cannot accidentally
 * render a buyer photo under the "Official Media" badge by mixing one list.
 */
export const mediaItemSchema = z.object({
  id: z.uuid(),
  url: z.url(),
  type: z.enum(MediaType),
  altText: z.string().nullable(),
  isOfficial: z.boolean(),
});

export const variantSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  nominalSize: z.number().int(),
  colour: z.string(),
  /** Effective price — the variant's override if it has one, else the product's. */
  pricePaise: z.number().int(),
  stockQuantity: z.number().int(),
  inStock: z.boolean(),
});

export const reviewSummarySchema = z.object({
  totalCount: z.number().int(),
  /** Null rather than 0 when there are no reviews — 0.0 stars reads as a bad product. */
  averageRating: z.number().nullable(),
  ratingCounts: z.record(z.string(), z.number().int()),
  /** Powers the "most buyers say this runs small" line above the size chart. */
  fitTagCounts: z.record(z.enum(FitTag), z.number().int()),
});

export const productDetailSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  pricePaise: z.number().int(),
  compareAtPricePaise: z.number().int().nullable(),
  fabricType: z.enum(FabricType),
  printTechnique: z.enum(PrintTechnique).nullable(),
  category: z.object({ slug: z.string(), name: z.string() }),
  brand: z.object({ slug: z.string(), name: z.string() }),
  variants: z.array(variantSchema),
  /** Distinct in-stock chips for the size/colour selectors. */
  availableSizes: z.array(z.number().int()),
  availableColours: z.array(z.string()),
  officialMedia: z.array(mediaItemSchema),
  buyerMedia: z.array(mediaItemSchema),
  /** Null when the product has no chart, or a malformed one — the client falls back to the enquiry form. */
  sizeChart: sizeChartSchema.nullable(),
  reviewSummary: reviewSummarySchema,
});

export class ProductDetailDto extends createZodDto(productDetailSchema) {}
