import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Powers the "Shop by brand" rail. */
export const brandSchema = z.object({
  slug: z.string(),
  name: z.string(),
  logoUrl: z.url().nullable(),
  displayOrder: z.number().int(),
});

export class BrandDto extends createZodDto(brandSchema) {}
