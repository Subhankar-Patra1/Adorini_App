import { buildSizeChart, NOMINAL_SIZES } from './size-charts';
import { FabricType } from '../../common/enums/domain.enums';
import { sizeRulesSchema } from '../../common/schemas/size-rules.schema';

describe('buildSizeChart', () => {
  it('covers every stocked nominal size exactly once', () => {
    const chart = buildSizeChart(FabricType.RIGID, 110);

    expect(chart.entries.map((e) => e.nominalSize)).toEqual([...NOMINAL_SIZES]);
  });

  it('produces charts that satisfy the size_rules contract', () => {
    // If a seed could produce a payload the admin endpoint would reject as
    // malformed (@GUARD Risk #5), the two would be out of step.
    for (const fabricType of [FabricType.RIGID, FabricType.STRETCH]) {
      expect(() => sizeRulesSchema.parse(buildSizeChart(fabricType, 110))).not.toThrow();
    }
  });

  it('gives stretch fabric a wider fit range than rigid at the same size', () => {
    // This asymmetry is the returns-reduction mechanism. If these two ever
    // produce the same range, the dynamic size chart has silently become a
    // static one and the feature stops doing anything.
    const rigid = buildSizeChart(FabricType.RIGID, 110);
    const stretch = buildSizeChart(FabricType.STRETCH, 110);

    for (const size of NOMINAL_SIZES) {
      const r = rigid.entries.find((e) => e.nominalSize === size)!;
      const s = stretch.entries.find((e) => e.nominalSize === size)!;

      const rigidBand = r.bust.maxCm - r.bust.minCm;
      const stretchBand = s.bust.maxCm - s.bust.minCm;

      expect(stretchBand).toBeGreaterThan(rigidBand);
    }
  });

  it('lets stretch fabric accommodate more above the nominal than below', () => {
    const stretch = buildSizeChart(FabricType.STRETCH, 110);
    const size42 = stretch.entries.find((e) => e.nominalSize === 42)!;
    const nominalBustCm = Math.round(42 * 2.54);

    // Stretch expands over a larger body but hangs loose on a smaller one, so
    // the range must be lopsided upward — a symmetric range would tell a buyer
    // to size up when she should not.
    expect(size42.bust.maxCm - nominalBustCm).toBeGreaterThan(nominalBustCm - size42.bust.minCm);
  });

  it('keeps every range ordered and every measurement positive', () => {
    for (const fabricType of [FabricType.RIGID, FabricType.STRETCH]) {
      for (const entry of buildSizeChart(fabricType, 110).entries) {
        for (const range of [entry.bust, entry.waist, entry.hip]) {
          expect(range.minCm).toBeLessThanOrEqual(range.maxCm);
          expect(range.minCm).toBeGreaterThan(0);
        }
        expect(entry.waist.maxCm).toBeLessThan(entry.bust.maxCm);
        expect(entry.hip.maxCm).toBeGreaterThan(entry.bust.maxCm);
      }
    }
  });

  it('carries fabric-appropriate guidance for the between-sizes case', () => {
    expect(buildSizeChart(FabricType.RIGID, 110).guidanceNote).toMatch(/larger/i);
    expect(buildSizeChart(FabricType.STRETCH, 110).guidanceNote).toMatch(/smaller/i);
  });
});
