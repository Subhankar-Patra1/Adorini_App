import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { SizeEnquiryStatus } from '../../../common/enums/domain.enums';
import { phoneSchema } from '../../../common/utils/phone.util';

/**
 * Normalised to E.164 without the `+`, matching `User.phone`.
 *
 * Uses the shared `phoneSchema` rather than a local normaliser so enquiry
 * contacts and account phones agree exactly. An earlier local version passed
 * unrecognised input straight through, which meant `09876543210` was stored
 * verbatim while `9876543210` became `919876543210` — the same buyer appearing
 * in the admin inbox as two unrelated people, which is the precise failure the
 * comment above it warned about.
 */
const contactPhoneSchema = phoneSchema;

export const createSizeEnquirySchema = z.object({
  /**
   * Free text, not a nominal size — the entire point is that it falls outside
   * the stocked 40–48 band ("50", "custom 46 with longer sleeves").
   */
  requestedSize: z.string().trim().min(1).max(32),
  contactPhone: contactPhoneSchema,
  message: z.string().trim().max(1000).optional(),
});

export class CreateSizeEnquiryDto extends createZodDto(createSizeEnquirySchema) {}

export const sizeEnquiryResponseSchema = z.object({
  id: z.uuid(),
  requestedSize: z.string(),
  status: z.enum(SizeEnquiryStatus),
  createdAt: z.iso.datetime(),
});

export class SizeEnquiryResponseDto extends createZodDto(sizeEnquiryResponseSchema) {}
