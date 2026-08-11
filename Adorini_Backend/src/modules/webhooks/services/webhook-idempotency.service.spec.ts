import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, QueryFailedError } from 'typeorm';

import { WebhookIdempotencyService } from './webhook-idempotency.service';
import { WebhookProvider } from '../../../common/enums/domain.enums';
import { ProcessedWebhook } from '../../../database/entities/processed-webhook.entity';
import { RedisService } from '../../../providers/redis/redis.service';

function uniqueViolation(): QueryFailedError {
  const error = new QueryFailedError('INSERT', [], new Error('duplicate key'));
  (error as unknown as { driverError: { code: string } }).driverError = { code: '23505' };
  return error;
}

describe('WebhookIdempotencyService', () => {
  let service: WebhookIdempotencyService;
  let manager: { save: jest.Mock; create: jest.Mock };
  let redis: { exists: jest.Mock; setex: jest.Mock };
  let transaction: jest.Mock;

  const event = {
    provider: WebhookProvider.DELHIVERY,
    eventId: 'AWB123:2026-08-12T00:00:00Z:DL',
    eventType: 'DL',
    payload: { Shipment: {} },
  };

  beforeEach(async () => {
    manager = {
      save: jest.fn((_entity: unknown, value: unknown) => value),
      create: jest.fn((_entity: unknown, value: unknown) => value),
    };
    transaction = jest.fn(
      async (cb: (m: typeof manager) => Promise<unknown>) => await cb(manager),
    );
    redis = { exists: jest.fn().mockResolvedValue(0), setex: jest.fn().mockResolvedValue('OK') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookIdempotencyService,
        { provide: DataSource, useValue: { transaction } },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(WebhookIdempotencyService);
  });

  it('records the event and runs the side effects in one transaction', async () => {
    const apply = jest.fn().mockResolvedValue({ relatedEntityId: 'order-1', result: 'processed' });

    const result = await service.ingest(event, apply);

    expect(result).toEqual({ status: 'processed', result: 'processed' });
    expect(transaction).toHaveBeenCalledTimes(1);
    // The marker row is written before the side effects, so a concurrent replay
    // collides on the unique index before it can credit anything.
    expect(manager.save).toHaveBeenCalledWith(
      ProcessedWebhook,
      expect.objectContaining({
        webhookProvider: WebhookProvider.DELHIVERY,
        webhookEventId: event.eventId,
      }),
    );
    expect(apply).toHaveBeenCalledWith(manager);
  });

  it('back-fills the related entity id onto the marker row', async () => {
    const apply = jest.fn().mockResolvedValue({ relatedEntityId: 'order-7', result: 'processed' });

    await service.ingest(event, apply);

    expect(manager.save).toHaveBeenCalledWith(
      ProcessedWebhook,
      expect.objectContaining({ relatedEntityId: 'order-7' }),
    );
  });

  it('reports a duplicate without re-running side effects when the constraint fires', async () => {
    const apply = jest.fn();
    transaction.mockRejectedValue(uniqueViolation());

    const result = await service.ingest(event, apply);

    expect(result).toEqual({ status: 'duplicate' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('short-circuits on the Redis fast path without opening a transaction', async () => {
    redis.exists.mockResolvedValue(1);
    const apply = jest.fn();

    const result = await service.ingest(event, apply);

    expect(result).toEqual({ status: 'duplicate' });
    expect(transaction).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('processes normally when Redis is unavailable — the DB constraint is the guarantee', async () => {
    redis.exists.mockRejectedValue(new Error('redis down'));
    const apply = jest.fn().mockResolvedValue({ relatedEntityId: null, result: 'processed' });

    const result = await service.ingest(event, apply);

    expect(result).toEqual({ status: 'processed', result: 'processed' });
    expect(apply).toHaveBeenCalled();
  });

  it('still succeeds when caching the marker fails afterwards', async () => {
    redis.setex.mockRejectedValue(new Error('redis down'));
    const apply = jest.fn().mockResolvedValue({ relatedEntityId: null, result: 'processed' });

    await expect(service.ingest(event, apply)).resolves.toEqual({
      status: 'processed',
      result: 'processed',
    });
  });

  it('propagates errors that are not duplicate-key violations', async () => {
    transaction.mockRejectedValue(new Error('connection reset'));

    await expect(service.ingest(event, jest.fn())).rejects.toThrow('connection reset');
  });

  it('caches the marker after a duplicate so the next replay skips the database', async () => {
    transaction.mockRejectedValue(uniqueViolation());

    await service.ingest(event, jest.fn());

    expect(redis.setex).toHaveBeenCalledWith(
      `webhook:seen:DELHIVERY:${event.eventId}`,
      86_400,
      '1',
    );
  });
});
