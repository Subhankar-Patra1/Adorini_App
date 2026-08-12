import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const isoTimestamp = z.iso.datetime();

/**
 * A minimal product summary for a "shop this look" chip — deliberately not
 * the full catalog `ProductSummaryDto`. A video feed scrolls fast; the chip
 * only ever needs enough to render itself and to link to the PDP, not the
 * full filterable-listing shape catalog carries.
 */
export const taggedProductSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  pricePaise: z.number().int(),
  thumbnailUrl: z.url().nullable(),
});

export const videoFeedItemSchema = z.object({
  id: z.uuid(),
  url: z.url(),
  thumbnailUrl: z.url().nullable(),
  caption: z.string().nullable(),
  taggedProducts: z.array(taggedProductSchema),
  createdAt: isoTimestamp,
});

export class VideoFeedItemDto extends createZodDto(videoFeedItemSchema) {}

export const listVideosQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export class ListVideosQueryDto extends createZodDto(listVideosQuerySchema) {}

export const videoFeedResponseSchema = z.object({
  items: z.array(videoFeedItemSchema),
  nextCursor: z.string().nullable(),
});

export class VideoFeedResponseDto extends createZodDto(videoFeedResponseSchema) {}

// ---- admin ----

/**
 * Arrives as multipart/form-data alongside the video file, so `productIds`
 * cannot be a real JSON array on the wire — it is sent as a JSON-encoded
 * string and parsed here, same reasoning as every other multipart field on
 * this API being coerced from text.
 */
export const createVideoSchema = z.object({
  caption: z.string().trim().max(2000).optional(),
  productIds: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return [] as string[];
      try {
        const parsed: unknown = JSON.parse(raw);
        const result = z.array(z.uuid()).safeParse(parsed);
        if (!result.success) {
          ctx.addIssue({ code: 'custom', message: 'productIds must be a JSON array of UUIDs' });
          return z.NEVER;
        }
        return result.data;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'productIds must be valid JSON' });
        return z.NEVER;
      }
    }),
});

export class CreateVideoDto extends createZodDto(createVideoSchema) {}

export const updateVideoSchema = z.object({
  caption: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export class UpdateVideoDto extends createZodDto(updateVideoSchema) {}

export const replaceVideoTagsSchema = z.object({
  productIds: z.array(z.uuid()).max(10),
});

export class ReplaceVideoTagsDto extends createZodDto(replaceVideoTagsSchema) {}

export const adminVideoSchema = z.object({
  id: z.uuid(),
  url: z.url(),
  thumbnailUrl: z.url().nullable(),
  caption: z.string().nullable(),
  isActive: z.boolean(),
  taggedProductIds: z.array(z.uuid()),
  createdAt: isoTimestamp,
});

export class AdminVideoDto extends createZodDto(adminVideoSchema) {}
