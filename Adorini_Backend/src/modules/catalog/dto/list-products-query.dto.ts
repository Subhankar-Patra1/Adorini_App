import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { FabricType, PrintTechnique } from '../../../common/enums/domain.enums';

/**
 * Sort modes exposed to the client. Each maps to a single indexed column in
 * `CatalogService` so every sort order stays a cheap seek, never a full scan
 * (see @GUARD Risk #4 on the `Product` entity).
 */
export const catalogSortSchema = z.enum(['newest', 'price_asc', 'price_desc']);
export type CatalogSort = z.infer<typeof catalogSortSchema>;

export const listProductsQuerySchema = z
  .object({
    category: z.string().min(1).max(64).optional(),
    brand: z.string().min(1).max(64).optional(),
    fabricType: z.enum(FabricType).optional(),
    printTechnique: z.enum(PrintTechnique).optional(),
    /** Nominal size — only products with in-stock variants at this size match. */
    size: z.coerce.number().int().min(40).max(48).optional(),
    minPrice: z.coerce.number().int().nonnegative().optional(),
    maxPrice: z.coerce.number().int().positive().optional(),
    q: z.string().trim().min(1).max(100).optional(),
    sort: catalogSortSchema.default('newest'),
    /**
     * Opaque seek cursor from a previous page's `nextCursor`. Cursor-based
     * rather than offset-based: infinite scroll under concurrent catalog
     * writes would otherwise skip or repeat items as rows shift between pages.
     */
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice, {
    error: 'minPrice must be less than or equal to maxPrice',
    path: ['minPrice'],
  });

export class ListProductsQueryDto extends createZodDto(listProductsQuerySchema) {}
