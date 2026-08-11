import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

jest.mock('ioredis');

describe('RedisService', () => {
  let service: RedisService;
  let mockRedisClient: jest.Mocked<Redis>;

  beforeEach(async () => {
    mockRedisClient = {
      on: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
    } as unknown as jest.Mocked<Redis>;

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

  it('should delegate get/set/setex/del/exists to ioredis client', async () => {
    mockRedisClient.get.mockResolvedValue('val');
    expect(await service.get('key')).toBe('val');

    await service.set('key', 'val');
    expect(mockRedisClient.set).toHaveBeenCalledWith('key', 'val');

    await service.setex('key', 60, 'val');
    expect(mockRedisClient.setex).toHaveBeenCalledWith('key', 60, 'val');

    mockRedisClient.del.mockResolvedValue(1);
    expect(await service.del('key')).toBe(1);

    mockRedisClient.exists.mockResolvedValue(1);
    expect(await service.exists('key')).toBe(1);
  });

  it('should quit client onModuleDestroy', async () => {
    await service.onModuleDestroy();
    expect(mockRedisClient.quit).toHaveBeenCalled();
  });
});
