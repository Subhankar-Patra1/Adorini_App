import { Test } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let pingCheck: jest.Mock;
  let check: jest.Mock;

  beforeEach(async () => {
    pingCheck = jest.fn();
    // Stand-in for Terminus's aggregator: run the indicators it was handed so a
    // failing dependency surfaces here the way it would in production.
    check = jest.fn(async (indicators: (() => Promise<Record<string, unknown>>)[]) => {
      const results = await Promise.all(indicators.map((fn) => fn()));
      const merged = results.reduce<Record<string, unknown>>(
        (acc, result) => ({ ...acc, ...result }),
        {},
      );

      return { status: 'ok', info: merged, error: {}, details: merged };
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check } },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck } },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  describe('liveness', () => {
    it('reports ok with an ISO-8601 timestamp', () => {
      const result = controller.check();

      expect(result.status).toBe('ok');
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('answers without consulting the database', () => {
      // Liveness must not fail on degraded dependencies — Railway would
      // otherwise kill a process that is actually alive. A database ping here
      // would turn a Postgres blip into a restart loop.
      pingCheck.mockRejectedValue(new Error('Postgres is down'));

      expect(() => controller.check()).not.toThrow();
      expect(pingCheck).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('pings the database', async () => {
      pingCheck.mockResolvedValue({ database: { status: 'up' } });

      const result = await controller.readiness();

      expect(pingCheck).toHaveBeenCalledWith('database', { timeout: 3000 });
      expect(result.details).toEqual({ database: { status: 'up' } });
    });

    it('propagates a database failure rather than reporting ready', async () => {
      // An instance that cannot reach Postgres must be drained of traffic, not
      // left in rotation serving errors.
      pingCheck.mockRejectedValue(new Error('connection refused'));

      await expect(controller.readiness()).rejects.toThrow('connection refused');
    });
  });
});
