import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { SizeChartService } from './size-chart.service';
import { FabricType } from '../../../common/enums/domain.enums';
import type { SizeRules } from '../../../common/schemas/size-rules.schema';
import { buildSizeChart } from '../../../database/seeds/size-charts';
import type { Product } from '../../../database/entities/product.entity';

type ChartInput = Pick<Product, 'id' | 'sizeRules' | 'fabricType'>;

function product(sizeRules: SizeRules | null, fabricType = FabricType.RIGID): ChartInput {
  return { id: 'p1', sizeRules, fabricType };
}

describe('SizeChartService', () => {
  let service: SizeChartService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SizeChartService],
    }).compile();

    service = module.get(SizeChartService);
  });

  it('returns null when the product has no size rules', () => {
    expect(service.render(product(null))).toBeNull();
  });

  it('returns null rather than throwing when size_rules is malformed', () => {
    const malformed = { fabricType: 'WOOL', entries: [] } as unknown as SizeRules;
    expect(service.render(product(malformed))).toBeNull();
  });

  it('renders a rigid chart with no-give advice', () => {
    const rules = buildSizeChart(FabricType.RIGID, 110);

    const chart = service.render(product(rules, FabricType.RIGID));

    expect(chart).not.toBeNull();
    expect(chart?.stretches).toBe(false);
    expect(chart?.fabricType).toBe(FabricType.RIGID);
    expect(chart?.rows).toHaveLength(5);
    expect(chart?.rows[0].fitAdvice).toContain('no give');
    expect(chart?.rows[0].fitAdvice).toContain('larger');
  });

  it('renders a stretch chart with size-down advice', () => {
    const rules = buildSizeChart(FabricType.STRETCH, 108);

    const chart = service.render(product(rules, FabricType.STRETCH));

    expect(chart?.stretches).toBe(true);
    expect(chart?.rows[0].fitAdvice).toContain('stretches to');
    expect(chart?.rows[0].fitAdvice).toContain('smaller');
  });

  it('quotes the stored measurement range rather than recomputing tolerances', () => {
    const rules = buildSizeChart(FabricType.STRETCH, 108);
    const first = rules.entries[0];

    const chart = service.render(product(rules, FabricType.STRETCH));

    expect(chart?.rows[0].bust).toEqual(first.bust);
    expect(chart?.rows[0].fitAdvice).toContain(`${first.bust.minCm}cm`);
    expect(chart?.rows[0].fitAdvice).toContain(`${first.bust.maxCm}cm`);
  });

  it('sorts rows by nominal size regardless of stored order', () => {
    const rules = buildSizeChart(FabricType.RIGID, 110);
    const shuffled: SizeRules = { ...rules, entries: [...rules.entries].reverse() };

    const chart = service.render(product(shuffled, FabricType.RIGID));

    expect(chart?.rows.map((r) => r.nominalSize)).toEqual([40, 42, 44, 46, 48]);
  });

  it('passes the authored guidance note through and adds a measurement note', () => {
    const rules = buildSizeChart(FabricType.STRETCH, 108);

    const chart = service.render(product(rules, FabricType.STRETCH));

    expect(chart?.guidanceNote).toBe(rules.guidanceNote);
    expect(chart?.measurementNote).toContain('body measurements');
  });
});
