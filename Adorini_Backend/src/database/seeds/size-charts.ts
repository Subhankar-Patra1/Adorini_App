import { FabricType } from '../../common/enums/domain.enums';
import { type SizeRules, sizeRulesSchema } from '../../common/schemas/size-rules.schema';

/** The sizes Adorini stocks. Anything outside this goes to the enquiry form. */
export const NOMINAL_SIZES = [40, 42, 44, 46, 48] as const;

/**
 * Nominal sizes are bust measurements in inches, which is how the Indian ethnic
 * wear trade labels them. The catalogue stores centimetres, so the label is the
 * conversion — size 42 means a 42-inch bust, or 107cm.
 */
function nominalSizeToBustCm(nominalSize: number): number {
  return Math.round(nominalSize * 2.54);
}

/**
 * Tolerance around the nominal measurement, in centimetres, per fabric family.
 * This asymmetry is the entire returns-reduction mechanism.
 *
 * A rigid fabric — cotton, silk, most Ajrak and Kalankari prints — has no give.
 * It fits a narrow band and a buyer 3cm over the nominal will not get into it,
 * so the chart must say so before she orders rather than after.
 *
 * A stretch fabric accommodates upward far more than downward: it expands over
 * a larger body but hangs loose on a smaller one. Hence the lopsided range.
 * Applying a symmetric tolerance to both is how a size chart ends up telling
 * a stretch-fabric buyer to size up when she should not.
 */
const FABRIC_TOLERANCE_CM: Record<FabricType, { under: number; over: number }> = {
  [FabricType.RIGID]: { under: 2, over: 2 },
  [FabricType.STRETCH]: { under: 4, over: 6 },
};

const GUIDANCE: Record<FabricType, string> = {
  [FabricType.RIGID]:
    'Non-stretch fabric — it will not give. If you are between two sizes, choose the larger.',
  [FabricType.STRETCH]:
    'Stretch fabric with up to 6cm of give. If you are between two sizes, choose the smaller for a fitted look.',
};

/**
 * Builds a complete fabric-appropriate size chart for the stocked size band.
 *
 * The result is parsed through `sizeRulesSchema` before being returned, so a
 * seed can never introduce a `size_rules` payload that the admin endpoint would
 * later reject as malformed (@GUARD Risk #5).
 */
export function buildSizeChart(fabricType: FabricType, garmentLengthCm: number): SizeRules {
  const tolerance = FABRIC_TOLERANCE_CM[fabricType];

  const entries = NOMINAL_SIZES.map((nominalSize) => {
    const bustCm = nominalSizeToBustCm(nominalSize);
    // Standard ethnic-wear block: waist sits ~20cm under bust, hip ~3cm over.
    const waistCm = bustCm - 20;
    const hipCm = bustCm + 3;

    const range = (centreCm: number) => ({
      minCm: centreCm - tolerance.under,
      maxCm: centreCm + tolerance.over,
    });

    return {
      nominalSize,
      bust: range(bustCm),
      waist: range(waistCm),
      hip: range(hipCm),
      garmentLengthCm,
    };
  });

  return sizeRulesSchema.parse({
    fabricType,
    entries,
    guidanceNote: GUIDANCE[fabricType],
  });
}
