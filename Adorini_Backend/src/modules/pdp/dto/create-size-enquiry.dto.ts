import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { SizeEnquiryStatus } from '../../../common/enums/domain.enums';

/**
 * Normalised to E.164 without the `+`, matching `User.phone` — a bare
 * 10-digit Indian mobile gains the `91` country code. Storing raw input would
 * let `+91 98765 43210` and `9876543210` become two enquiries the admin inbox
 * shows as unrelated people.
 */
const contactPhoneSchema = z
  .string()
  .transform((raw) => {
    const digits = raw.replace(/\D/g, '');
    return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : digits;
  })
  .refine((digits) => /^\d{10,15}$/.test(digits), {
    error: 'contactPhone must be a valid phone number',
  });

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
