import { z } from 'zod';

import { FabricType } from '../enums/domain.enums';

/**
 * The `products.size_rules` JSONB contract.
 *
 * This schema is the single source of truth: the entity's TypeScript type is
 * inferred from it, and the admin module (Phase 4) parses writes through it to
 * satisfy @GUARD Risk #5 — malformed rules must be rejected, never persisted.
 * Defining it here rather than beside the controller is what keeps the stored
 * shape and the validated shape from drifting.
 *
 * Measurements are centimetres held as integers. Half-centimetre precision is
 * below the accuracy of a buyer measuring themselves at home, and integers
 * dodge the float-comparison edge cases in range checks.
 */
export const sizeRangeSchema = z
  .object({
    minCm: z.number().int().positive(),
    maxCm: z.number().int().positive(),
  })
  .refine((r) => r.minCm <= r.maxCm, {
    error: 'minCm must be less than or equal to maxCm',
  });

export const sizeRuleEntrySchema = z.object({
  /** Nominal size as printed on the label. Adorini's band is 40–48. */
  nominalSize: z.number().int().min(40).max(48),
  bust: sizeRangeSchema,
  waist: sizeRangeSchema,
  hip: sizeRangeSchema,
  garmentLengthCm: z.number().int().positive(),
});

export const sizeRulesSchema = z
  .object({
    /**
     * Denormalised from `products.fabric_type` so a size chart is interpretable
     * on its own. The admin service must reject a payload whose `fabricType`
     * disagrees with the product's column.
     */
    fabricType: z.enum(FabricType),
    entries: z.array(sizeRuleEntrySchema).min(1, {
      error: 'A size chart needs at least one size entry',
    }),
    /** Shown under the chart, e.g. "Stretches up to 5cm — size down if between sizes." */
    guidanceNote: z.string().max(280).optional(),
  })
  .refine(
    (rules) => new Set(rules.entries.map((e) => e.nominalSize)).size === rules.entries.length,
    { error: 'Each nominal size may appear only once in a size chart' },
  );

export type SizeRange = z.infer<typeof sizeRangeSchema>;
export type SizeRuleEntry = z.infer<typeof sizeRuleEntrySchema>;
export type SizeRules = z.infer<typeof sizeRulesSchema>;
