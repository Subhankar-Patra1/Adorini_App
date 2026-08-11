import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const categorySchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  displayOrder: z.number().int(),
});

export class CategoryDto extends createZodDto(categorySchema) {}
