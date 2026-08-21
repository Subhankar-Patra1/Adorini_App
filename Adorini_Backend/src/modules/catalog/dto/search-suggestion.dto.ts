import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * What a suggestion points at, which decides what tapping it does.
 *
 * Carrying the kind rather than only a label is what lets the app act
 * correctly: a category suggestion should open the filtered grid, while a
 * product suggestion should open that product. Sending back bare strings would
 * force the app to re-search a name it already knows the answer to.
 */
export const suggestionKindSchema = z.enum(['CATEGORY', 'BRAND', 'PRODUCT']);

export const searchSuggestionSchema = z.object({
  kind: suggestionKindSchema,
  /** Shown to the shopper. */
  label: z.string(),
  /** Category slug, brand slug, or product slug depending on `kind`. */
  slug: z.string(),
});

export const searchSuggestionsResponseSchema = z.object({
  items: z.array(searchSuggestionSchema),
});

export class SearchSuggestionsResponseDto extends createZodDto(
  searchSuggestionsResponseSchema,
) {}

export const suggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export class SuggestQueryDto extends createZodDto(suggestQuerySchema) {}
