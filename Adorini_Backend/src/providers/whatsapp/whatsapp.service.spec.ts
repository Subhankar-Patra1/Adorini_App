import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { WhatsAppService, WhatsAppProviderError } from './whatsapp.service';

describe('WhatsAppService', () => {
  let service: WhatsAppService;
  const globalFetchBackup = global.fetch;

  const config = {
    WHATSAPP_ACCESS_TOKEN: 'test_access_token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_API_VERSION: 'v21.0',
    WHATSAPP_OTP_TEMPLATE_NAME: 'adorini_otp',
    WHATSAPP_TEMPLATE_LANGUAGE: 'en',
  } as const;

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
        WhatsAppService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: keyof typeof config) => config[key] ?? ''),
          },
        },
      ],
    }).compile();

    service = module.get<WhatsAppService>(WhatsAppService);
  });

  afterAll(() => {
    global.fetch = globalFetchBackup;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /**
   * Local-dev seam: placeholder Meta credentials make every login impossible,
   * because no WhatsApp message can arrive. These tests pin both halves of
   * that trade — the code reaches the console in development, and never at
   * the cost of a real send happening in production.
   */
  describe('placeholder-credential OTP logging', () => {
    async function buildWith(overrides: Record<string, string>): Promise<WhatsAppService> {
      const merged = { ...config, ...overrides } as Record<string, string>;
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WhatsAppService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn((key: string) => merged[key] ?? '') },
          },
        ],
      }).compile();
      return module.get<WhatsAppService>(WhatsAppService);
    }

    it('logs the code and skips Meta when credentials are placeholders', async () => {
      const dev = await buildWith({
        NODE_ENV: 'development',
        WHATSAPP_ACCESS_TOKEN: 'placeholder-until-meta-live',
      });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(dev.sendOtp('919999999999', '123456')).resolves.toBeUndefined();

      expect(global.fetch).not.toHaveBeenCalled();
      // The code must be printed in full — a masked one would be useless.
      expect(warn.mock.calls.flat().join(' ')).toContain('123456');
      warn.mockRestore();
    });

    it('still calls Meta in production even if a credential looks like a placeholder', async () => {
      const prod = await buildWith({
        NODE_ENV: 'production',
        WHATSAPP_ACCESS_TOKEN: 'placeholder-until-meta-live',
      });
      mockFetchOnce({ ok: true, json: { messages: [{ id: 'wamid.1' }] } });

      await prod.sendOtp('919999999999', '123456');

      // env validation blocks this config from booting production at all; if it
      // ever ran, it must not silently swallow OTPs into a log file.
      expect(global.fetch).toHaveBeenCalled();
    });

    it('calls Meta normally when credentials are real', async () => {
      mockFetchOnce({ ok: true, json: { messages: [{ id: 'wamid.1' }] } });

      await service.sendOtp('919999999999', '123456');

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('sendOtp', () => {
    it('calls the Graph API messages endpoint with a bearer token and a deadline', async () => {
      mockFetchOnce({ ok: true, json: { messages: [{ id: 'wamid.1' }] } });

      await expect(service.sendOtp('919999999999', '123456')).resolves.toBeUndefined();

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];

      expect(url).toBe('https://graph.facebook.com/v21.0/123456789/messages');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).authorization).toBe(
        'Bearer test_access_token',
      );
      // No deadline means a stalled Meta call hangs a checkout indefinitely.
      expect(init.signal).toBeDefined();

      const payload = JSON.parse(init.body as string) as {
        template: { name: string; components: { type: string; parameters: unknown[] }[] };
      };
      expect(payload.template.name).toBe('adorini_otp');
      expect(payload.template.components[0]).toEqual({
        type: 'body',
        parameters: [{ type: 'text', text: '123456' }],
      });
    });

    it('throws on a non-ok HTTP response', async () => {
      mockFetchOnce({ ok: false, status: 500, text: 'Internal Server Error' });

      await expect(service.sendOtp('919999999999', '123456')).rejects.toThrow(
        WhatsAppProviderError,
      );
    });

    it('throws when Meta reports an error inside a 200 response', async () => {
      // Meta signals an unapproved template or an unreachable number this way.
      // A 2xx alone is not proof the message was sent.
      mockFetchOnce({
        ok: true,
        json: { error: { message: 'template not approved', code: 132001 } },
      });

      await expect(service.sendOtp('919999999999', '123456')).rejects.toThrow(
        /template not approved/,
      );
    });

    it('surfaces a timeout as WhatsAppProviderError, not a raw abort', async () => {
      const timeoutError = new Error('The operation was aborted due to timeout');
      timeoutError.name = 'TimeoutError';
      (global.fetch as jest.Mock).mockRejectedValue(timeoutError);

      const error = (await service
        .sendOtp('919999999999', '123456')
        .catch((e: unknown) => e)) as WhatsAppProviderError;

      expect(error).toBeInstanceOf(WhatsAppProviderError);
      expect(error.message).toMatch(/timed out/i);
    });

    it('tolerates a non-JSON response body without throwing a parse error', async () => {
      mockFetchOnce({ ok: true, text: '<html>edge error page</html>' });

      await expect(service.sendOtp('919999999999', '123456')).resolves.toBeUndefined();
    });
  });

  describe('notifyTemplate', () => {
    it('sends body params in positional order as {{1}}, {{2}}, ...', async () => {
      mockFetchOnce({ ok: true, json: { messages: [{ id: 'wamid.2' }] } });

      await service.notifyTemplate('919999999999', 'adorini_delivery_retry', {
        body_1: 'ADR-1',
        body_2: '24',
      });

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string) as {
        to: string;
        template: { name: string; components: { type: string; parameters: { text: string }[] }[] };
      };

      expect(payload.to).toBe('919999999999');
      expect(payload.template.name).toBe('adorini_delivery_retry');
      expect(payload.template.components[0].parameters.map((p) => p.text)).toEqual(['ADR-1', '24']);
    });

    it('throws on a non-ok response', async () => {
      mockFetchOnce({ ok: false, status: 400, text: 'bad template' });

      await expect(service.notifyTemplate('919999999999', 'nope', {})).rejects.toThrow(
        WhatsAppProviderError,
      );
    });

    it('throws when Meta reports an error inside a 200 response', async () => {
      mockFetchOnce({
        ok: true,
        json: { error: { message: 'recipient has no WhatsApp account' } },
      });

      await expect(
        service.notifyTemplate('919999999999', 'adorini_delivery_retry', { body_1: 'ADR-1' }),
      ).rejects.toThrow(/no WhatsApp account/);
    });
  });
});
