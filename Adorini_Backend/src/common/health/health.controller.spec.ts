import { Test } from '@nestjs/testing';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('reports ok with an ISO-8601 timestamp', () => {
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('has no dependencies, so it still answers when Postgres/Redis are down', () => {
    // Liveness must not fail on degraded dependencies — Railway would otherwise
    // kill a process that is actually alive. Readiness lands in Phase 2.
    expect(() => controller.check()).not.toThrow();
  });
});
