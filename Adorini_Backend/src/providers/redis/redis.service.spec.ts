import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { RedisService, RedisProviderError } from './redis.service';

jest.mock('ioredis');

describe('RedisService', () => {
  let service: RedisService;

  // Standalone mock functions rather than methods hung off an object literal —
  // asserting on `expect(client.set)` would reference an unbound method, which
  // is both a lint error and a real `this`-scoping hazard on a genuine class.
  let get: jest.Mock;
  let set: jest.Mock;
  let setex: jest.Mock;
  let del: jest.Mock;
  let exists: jest.Mock;
  let quit: jest.Mock;
  let disconnect: jest.Mock;

  beforeEach(async () => {
    get = jest.fn();
    set = jest.fn();
    setex = jest.fn();
    del = jest.fn();
    exists = jest.fn();
    quit = jest.fn().mockResolvedValue('OK');
    disconnect = jest.fn();

    const mockRedisClient = {
      on: jest.fn(),
      get,
      set,
      setex,
      del,
      exists,
      quit,
      disconnect,
    } as unknown as Redis;

    (Redis as unknown as jest.Mock).mockReturnValue(mockRedisClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('redis://localhost:6379'),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('connection configuration', () => {
    it('disables the offline queue so commands fail instead of hanging', () => {
      // With ioredis's default offline queue, a command issued while Redis is
      // down is buffered in memory and never settles — the caller waits
      // forever rather than getting an error it can handle.
      const [, options] = (Redis as unknown as jest.Mock).mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];

      expect(options.enableOfflineQueue).toBe(false);
      expect(options.connectTimeout).toBeGreaterThan(0);
      expect(options.maxRetriesPerRequest).toBe(3);
    });
  });

  describe('happy path', () => {
    it('delegates get/set/setex/del/exists to the ioredis client', async () => {
      get.mockResolvedValue('val');
      expect(await service.get('key')).toBe('val');

      await service.set('key', 'val');
      expect(set).toHaveBeenCalledWith('key', 'val');

      await service.setex('key', 60, 'val');
      expect(setex).toHaveBeenCalledWith('key', 60, 'val');

      del.mockResolvedValue(1);
      expect(await service.del('key')).toBe(1);

      exists.mockResolvedValue(1);
      expect(await service.exists('key')).toBe(1);
    });

    it('returns null for a missing key rather than throwing', async () => {
      get.mockResolvedValue(null);

      await expect(service.get('absent')).resolves.toBeNull();
    });
  });

  describe('failure paths — Redis unreachable or rejecting', () => {
    // The Phase 3 exit criterion: fail loudly with a typed error rather than
    // returning undefined. Callers in Phase 4 must be able to catch exactly
    // this type — the webhook fast-path pre-check has to swallow Redis errors
    // (the DB constraint is the real guarantee, @GUARD Risk #1) while cart
    // reads must surface them.
    const connectionRefused = new Error('connect ECONNREFUSED 127.0.0.1:6379');

    it('wraps a failing get in RedisProviderError', async () => {
      get.mockRejectedValue(connectionRefused);

      await expect(service.get('key')).rejects.toThrow(RedisProviderError);
    });

    it('wraps a failing set in RedisProviderError', async () => {
      set.mockRejectedValue(connectionRefused);

      await expect(service.set('key', 'val')).rejects.toThrow(RedisProviderError);
    });

    it('wraps a failing setex in RedisProviderError', async () => {
      setex.mockRejectedValue(connectionRefused);

      await expect(service.setex('key', 60, 'val')).rejects.toThrow(RedisProviderError);
    });

    it('wraps a failing del in RedisProviderError', async () => {
      del.mockRejectedValue(connectionRefused);

      await expect(service.del('key')).rejects.toThrow(RedisProviderError);
    });

    it('wraps a failing exists in RedisProviderError', async () => {
      exists.mockRejectedValue(connectionRefused);

      await expect(service.exists('key')).rejects.toThrow(RedisProviderError);
    });

    it('never resolves undefined on failure', async () => {
      // The precise wording of the exit criterion: a failed command must not
      // look like a cache miss. Treating an outage as "no cached value" is how
      // a rate limiter silently stops limiting.
      get.mockRejectedValue(connectionRefused);

      const result = await service.get('key').catch((e: unknown) => e);
      expect(result).toBeInstanceOf(RedisProviderError);
      expect(result).not.toBeUndefined();
    });

    it('names the failing operation and preserves the underlying error', async () => {
      get.mockRejectedValue(connectionRefused);

      const error = (await service.get('key').catch((e: unknown) => e)) as RedisProviderError;

      expect(error.operation).toBe('get');
      expect(error.originalError).toBe(connectionRefused);
      expect(error.message).toContain('ECONNREFUSED');
    });
  });

  describe('shutdown', () => {
    it('quits the client on module destroy', async () => {
      await service.onModuleDestroy();
      expect(quit).toHaveBeenCalled();
    });

    it('force-disconnects instead of throwing when quit fails', async () => {
      // Shutdown must not throw: a failed quit would mask the real reason the
      // process is stopping.
      quit.mockRejectedValue(new Error('connection already gone'));

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(disconnect).toHaveBeenCalled();
    });
  });
});
