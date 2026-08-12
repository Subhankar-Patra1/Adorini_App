import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { SizeEnquiryStatus } from '../../../common/enums/domain.enums';
import { phoneSchema } from '../../../common/utils/phone.util';

export const createSizeEnquirySchema = z.object({
  /**
   * Free text, not a nominal size — the entire point is that it falls outside
   * the stocked 40–48 band ("50", "custom 46 with longer sleeves").
   */
  requestedSize: z.string().trim().min(1).max(32),
  /**
   * Shares `phoneSchema` with auth/users rather than normalising locally —
   * `users.phone` is UNIQUE, so two boundaries normalising differently would
   * let the same person reach the admin inbox as two unrelated enquiries.
   */
  contactPhone: phoneSchema,
  message: z.string().trim().max(1000).optional(),
});

export class CreateSizeEnquiryDto extends createZodDto(createSizeEnquirySchema) { }

export const sizeEnquiryResponseSchema = z.object({
  id: z.uuid(),
  requestedSize: z.string(),
  status: z.enum(SizeEnquiryStatus),
  createdAt: z.iso.datetime(),
});

export class SizeEnquiryResponseDto extends createZodDto(sizeEnquiryResponseSchema) { }
