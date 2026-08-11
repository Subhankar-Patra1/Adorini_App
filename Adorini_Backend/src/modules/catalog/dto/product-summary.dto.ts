import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { FabricType, PrintTechnique } from '../../../common/enums/domain.enums';

/** Catalog list/grid projection — deliberately thin. Full detail is the PDP module's job. */
export const productSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  pricePaise: z.number().int(),
  compareAtPricePaise: z.number().int().nullable(),
  fabricType: z.enum(FabricType),
  printTechnique: z.enum(PrintTechnique).nullable(),
  categorySlug: z.string(),
  brandSlug: z.string(),
  thumbnailUrl: z.url().nullable(),
});

export class ProductSummaryDto extends createZodDto(productSummarySchema) {}

export const productListResponseSchema = z.object({
  items: z.array(productSummarySchema),
  /** Pass back as `cursor` on the next request; `null` means this is the last page. */
  nextCursor: z.string().nullable(),
});

export class ProductListResponseDto extends createZodDto(productListResponseSchema) {}
