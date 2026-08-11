import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LogisticsService, LogisticsProviderError } from './logistics.service';

describe('LogisticsService', () => {
  let service: LogisticsService;
  const globalFetchBackup = global.fetch;

  beforeEach(async () => {
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogisticsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              switch (key) {
                case 'DELHIVERY_API_TOKEN':
                  return 'test_token';
                case 'DELHIVERY_BASE_URL':
                  return 'https://track.delhivery.com';
                default:
                  return '';
              }
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LogisticsService>(LogisticsService);
  });

  afterAll(() => {
    global.fetch = globalFetchBackup;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createShipment', () => {
    it('should format body as x-www-form-urlencoded and include Token header', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, packages: [{ waybill: '123456' }] }),
      });

      const payload = {
        shipments: [
          {
            name: 'Jane Doe',
            add: '123 Main St',
            pin: '110001',
            city: 'Delhi',
            state: 'Delhi',
            phone: '9999999999',
            order: 'ORD_100',
            payment_mode: 'Pre-paid' as const,
          },
        ],
        pickup_location: { name: 'Main Warehouse' },
      };

      const result = await service.createShipment(payload);
      expect(result.success).toBe(true);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://track.delhivery.com/api/cmu/create.json',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Token test_token',
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
          body: expect.stringContaining('format=json&data='),
        }),
      );
    });

    it('should throw LogisticsProviderError on HTTP failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(
        service.createShipment({ shipments: [], pickup_location: { name: '' } }),
      ).rejects.toThrow(LogisticsProviderError);
    });
  });

  describe('fetchTracking', () => {
    it('should send GET request to packages/json endpoint', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ShipData: [{ TrackStatus: 'In Transit' }] }),
      });

      const tracking = await service.fetchTracking('WB123');
      expect(tracking).toBeDefined();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://track.delhivery.com/api/v1/packages/json/?waybill=WB123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Token test_token' }),
        }),
      );
    });
  });
});
