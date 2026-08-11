import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { FabricType } from '../../../common/enums/domain.enums';

const measurementRangeSchema = z.object({
  minCm: z.number().int(),
  maxCm: z.number().int(),
});

export const sizeChartRowSchema = z.object({
  nominalSize: z.number().int(),
  bust: measurementRangeSchema,
  waist: measurementRangeSchema,
  hip: measurementRangeSchema,
  garmentLengthCm: z.number().int(),
  /**
   * Per-size prose that differs by fabric — the thing the buyer actually reads
   * before choosing. Rendered server-side so web and Flutter cannot drift into
   * giving contradictory fit advice for the same garment.
   */
  fitAdvice: z.string(),
});

export const sizeChartSchema = z.object({
  fabricType: z.enum(FabricType),
  /** True for STRETCH. Drives the chart banner's styling and copy on the client. */
  stretches: z.boolean(),
  /** Chart-level note authored with the rules (e.g. "size down if between sizes"). */
  guidanceNote: z.string().nullable(),
  /** Reminds the buyer these are body measurements, not flat-garment measurements. */
  measurementNote: z.string(),
  rows: z.array(sizeChartRowSchema),
});

export class SizeChartDto extends createZodDto(sizeChartSchema) {}
