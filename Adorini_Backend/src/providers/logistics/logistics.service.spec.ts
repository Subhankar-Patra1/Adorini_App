import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import {
  LogisticsService,
  LogisticsProviderError,
  type DelhiveryShipmentPayload,
} from './logistics.service';

describe('LogisticsService', () => {
  let service: LogisticsService;
  const globalFetchBackup = global.fetch;

  const config: Record<string, string> = {
    DELHIVERY_API_TOKEN: 'test_token',
    DELHIVERY_BASE_URL: 'https://track.delhivery.com',
  };

  const payload: DelhiveryShipmentPayload = {
    shipments: [
      {
        name: 'Jane Doe',
        add: '123 Main St',
        pin: '110001',
        city: 'Delhi',
        state: 'Delhi',
        phone: '9999999999',
        order: 'ORD_100',
        payment_mode: 'Pre-paid',
      },
    ],
    pickup_location: { name: 'Main Warehouse' },
  };

  function mockFetchOnce(response: {
    ok: boolean;
    status?: number;
    json?: unknown;
    text?: string;
  }): void {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: () =>
        response.json === undefined
          ? Promise.reject(new Error('not json'))
          : Promise.resolve(response.json),
      text: () => Promise.resolve(response.text ?? ''),
    });
  }

  beforeEach(async () => {
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogisticsService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key] ?? '') },
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
    it('sends form-encoded data with the Token header and a deadline', async () => {
      mockFetchOnce({ ok: true, json: { success: true, packages: [{ waybill: '123456' }] } });

      const result = await service.createShipment(payload);
      expect(result.success).toBe(true);

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];

      expect(url).toBe('https://track.delhivery.com/api/cmu/create.json');
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Token test_token');
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

      // Delhivery's create endpoint takes `format=json&data=<urlencoded json>`,
      // not a JSON body.
      expect(init.body).toContain('format=json&data=');
      expect(init.signal).toBeDefined();
    });

    it('throws when Delhivery reports failure inside a 200 response', async () => {
      // Delhivery answers a rejected shipment with HTTP 200 and success:false.
      // Trusting the status code would record a waybill that never existed.
      mockFetchOnce({
        ok: true,
        json: {
          success: false,
          packages: [
            { status: 'Fail', remarks: ['ClientWarehouse matching query does not exist'] },
          ],
        },
      });

      await expect(service.createShipment(payload)).rejects.toThrow(
        /ClientWarehouse matching query does not exist/,
      );
    });

    it('throws LogisticsProviderError on a non-ok HTTP response', async () => {
      mockFetchOnce({ ok: false, status: 401, text: 'Unauthorized' });

      await expect(service.createShipment(payload)).rejects.toThrow(LogisticsProviderError);
    });

    it('surfaces a timeout as LogisticsProviderError', async () => {
      const timeoutError = new Error('aborted due to timeout');
      timeoutError.name = 'TimeoutError';
      (global.fetch as jest.Mock).mockRejectedValue(timeoutError);

      const error = (await service
        .createShipment(payload)
        .catch((e: unknown) => e)) as LogisticsProviderError;

      expect(error).toBeInstanceOf(LogisticsProviderError);
      expect(error.message).toMatch(/timed out/i);
    });

    it('throws when Delhivery is unreachable', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ENOTFOUND'));

      await expect(service.createShipment(payload)).rejects.toThrow(/unreachable/i);
    });

    it('throws rather than returning undefined on a non-JSON body', async () => {
      mockFetchOnce({ ok: true });

      await expect(service.createShipment(payload)).rejects.toThrow(/non-JSON body/);
    });
  });

  describe('fetchTracking', () => {
    it('requests the waybill and returns the parsed payload', async () => {
      mockFetchOnce({
        ok: true,
        json: {
          ShipmentData: [{ Shipment: { AWB: '123456', Status: { Status: 'Delivered' } } }],
        },
      });

      const result = await service.fetchTracking('123456');

      expect(result.ShipmentData?.[0]?.Shipment?.Status?.Status).toBe('Delivered');

      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('waybill=123456');
    });

    it('url-encodes the waybill', async () => {
      mockFetchOnce({ ok: true, json: {} });

      await service.fetchTracking('AWB 12/34');

      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('AWB%2012%2F34');
    });

    it('throws LogisticsProviderError on a non-ok response', async () => {
      mockFetchOnce({ ok: false, status: 404, text: 'Not Found' });

      await expect(service.fetchTracking('nope')).rejects.toThrow(LogisticsProviderError);
    });
  });

  describe('base URL handling', () => {
    it('strips a trailing slash so paths do not double up', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          LogisticsService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) =>
                key === 'DELHIVERY_BASE_URL' ? 'https://track.delhivery.com/' : 'test_token',
              ),
            },
          },
        ],
      }).compile();

      const trailing = module.get<LogisticsService>(LogisticsService);
      mockFetchOnce({ ok: true, json: { success: true } });

      await trailing.createShipment(payload);

      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://track.delhivery.com/api/cmu/create.json');
    });
  });
});
