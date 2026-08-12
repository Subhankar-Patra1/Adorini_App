import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { FabricType, PrintTechnique, SizeEnquiryStatus } from '../../../common/enums/domain.enums';
import { sizeRulesSchema } from '../../../common/schemas/size-rules.schema';

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: 'Slug must be lowercase words separated by single hyphens',
  });

/**
 * Product creation.
 *
 * `sizeRules` is parsed through the shared `sizeRulesSchema` — the same schema
 * the seeds build against and the PDP renders from (@GUARD Risk #5). A chart
 * with a reversed range, a duplicate nominal size, or a size outside 40–48 is
 * rejected here and never reaches the JSONB column, so the PDP can render what
 * it finds without defending against malformed data.
 */
export const createProductSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  categoryId: z.uuid(),
  brandId: z.uuid(),
  pricePaise: z.number().int().positive(),
  compareAtPricePaise: z.number().int().positive().nullable().optional(),
  fabricType: z.enum(FabricType),
  printTechnique: z.enum(PrintTechnique).nullable().optional(),
  sizeRules: sizeRulesSchema.nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateProductSchema = createProductSchema.partial();

export const createVariantSchema = z.object({
  productId: z.uuid(),
  sku: z.string().trim().min(1).max(64),
  /** Mirrors `chk_variant_nominal_size_range` — the stocked band. */
  nominalSize: z.number().int().min(40).max(48),
  colour: z.string().trim().min(1).max(64),
  /** Null means "use the product's price", which is the common case. */
  pricePaise: z.number().int().positive().nullable().optional(),
  stockQuantity: z.number().int().nonnegative().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateVariantSchema = createVariantSchema.omit({ productId: true }).partial();

export const respondToEnquirySchema = z.object({
  status: z.enum(SizeEnquiryStatus),
  adminResponse: z.string().trim().max(2000).nullable().optional(),
});

export const listEnquiriesQuerySchema = z.object({
  status: z.enum(SizeEnquiryStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export const listAdminProductsQuerySchema = z.object({
  /** Admin listings include inactive products — that is the point of them. */
  includeInactive: z.coerce.boolean().optional().default(true),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export class CreateProductDto extends createZodDto(createProductSchema) {}
export class UpdateProductDto extends createZodDto(updateProductSchema) {}
export class CreateVariantDto extends createZodDto(createVariantSchema) {}
export class UpdateVariantDto extends createZodDto(updateVariantSchema) {}
export class RespondToEnquiryDto extends createZodDto(respondToEnquirySchema) {}
export class ListEnquiriesQueryDto extends createZodDto(listEnquiriesQuerySchema) {}
export class ListAdminProductsQueryDto extends createZodDto(listAdminProductsQuerySchema) {}

// ---- responses ----

export const adminProductSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  categoryId: z.uuid(),
  brandId: z.uuid(),
  pricePaise: z.number().int(),
  compareAtPricePaise: z.number().int().nullable(),
  fabricType: z.enum(FabricType),
  printTechnique: z.enum(PrintTechnique).nullable(),
  isActive: z.boolean(),
  hasSizeChart: z.boolean(),
  variantCount: z.number().int(),
});

export const adminVariantSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  sku: z.string(),
  nominalSize: z.number().int(),
  colour: z.string(),
  pricePaise: z.number().int().nullable(),
  stockQuantity: z.number().int(),
  isActive: z.boolean(),
});

export const adminEnquirySchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  productName: z.string(),
  requestedSize: z.string(),
  contactPhone: z.string(),
  message: z.string().nullable(),
  status: z.enum(SizeEnquiryStatus),
  adminResponse: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export class AdminProductDto extends createZodDto(adminProductSchema) {}
export class AdminVariantDto extends createZodDto(adminVariantSchema) {}
export class AdminEnquiryDto extends createZodDto(adminEnquirySchema) {}
