import { Injectable, Logger } from '@nestjs/common';

import type { SizeChartDto } from '../dto/size-chart.dto';
import { FabricType } from '../../../common/enums/domain.enums';
import { sizeRulesSchema } from '../../../common/schemas/size-rules.schema';
import type { Product } from '../../../database/entities/product.entity';

const MEASUREMENT_NOTE =
  'Measure yourself, not a garment — these are body measurements in centimetres.';

/**
 * Renders a product's stored `size_rules` into the fit guidance the PDP shows.
 *
 * The asymmetry between fabrics is the whole returns-reduction bet: a rigid
 * fabric fits a narrow band and must say so *before* the buyer orders, while a
 * stretch fabric accommodates upward and would be mis-served by the same copy.
 *
 * Advice is derived from the stored measurement ranges rather than recomputing
 * the tolerances that produced them. `buildSizeChart` in the seeds owns that
 * arithmetic; duplicating it here would let the chart a buyer reads drift from
 * the chart the database holds.
 */
@Injectable()
export class SizeChartService {
  private readonly logger = new Logger(SizeChartService.name);

  render(product: Pick<Product, 'id' | 'sizeRules' | 'fabricType'>): SizeChartDto | null {
    if (!product.sizeRules) {
      return null;
    }

    /**
     * Parsed on read as well as on write. Admin writes are validated
     * (@GUARD Risk #5), but `size_rules` is jsonb — a manual DB edit or an
     * older row can still hold a shape this code would otherwise index into
     * blindly. A PDP that renders no chart is recoverable; one that 500s on a
     * malformed chart takes the product page down.
     */
    const parsed = sizeRulesSchema.safeParse(product.sizeRules);
    if (!parsed.success) {
      this.logger.error(
        `Product ${product.id} has malformed size_rules; serving PDP without a size chart`,
      );
      return null;
    }

    const rules = parsed.data;
    const stretches = rules.fabricType === FabricType.STRETCH;

    return {
      fabricType: rules.fabricType,
      stretches,
      guidanceNote: rules.guidanceNote ?? null,
      measurementNote: MEASUREMENT_NOTE,
      rows: rules.entries
        .slice()
        .sort((a, b) => a.nominalSize - b.nominalSize)
        .map((entry) => ({
          nominalSize: entry.nominalSize,
          bust: entry.bust,
          waist: entry.waist,
          hip: entry.hip,
          garmentLengthCm: entry.garmentLengthCm,
          fitAdvice: stretches
            ? `Comfortable from a ${entry.bust.minCm}cm bust and stretches to ${entry.bust.maxCm}cm. Between sizes? Take the smaller one for a fitted look.`
            : `Fits a ${entry.bust.minCm}–${entry.bust.maxCm}cm bust with no give. Between sizes? Take the larger one.`,
        })),
    };
  }
}
