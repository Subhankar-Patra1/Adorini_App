import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { SmsService, SmsProviderError } from './sms.service';

describe('SmsService', () => {
  let service: SmsService;
  const globalFetchBackup = global.fetch;

  const config = {
    MSG91_AUTH_KEY: 'test_auth_key',
    MSG91_OTP_TEMPLATE_ID: 'test_template_id',
    MSG91_SENDER_ID: 'ADORNI',
    MSG91_WHATSAPP_NUMBER: '919000000000',
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
        SmsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: keyof typeof config) => config[key] ?? ''),
          },
        },
      ],
    }).compile();

    service = module.get<SmsService>(SmsService);
  });

  afterAll(() => {
    global.fetch = globalFetchBackup;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /**
   * Local-dev seam: placeholder MSG91 credentials make every login impossible,
   * because no SMS can arrive. These tests pin both halves of that trade — the
   * code reaches the console in development, and never at the cost of a real
   * send happening in production.
   */
  describe('placeholder-credential OTP logging', () => {
    async function buildWith(overrides: Record<string, string>): Promise<SmsService> {
      const merged = { ...config, ...overrides } as Record<string, string>;
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SmsService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn((key: string) => merged[key] ?? '') },
          },
        ],
      }).compile();
      return module.get<SmsService>(SmsService);
    }

    it('logs the code and skips MSG91 when credentials are placeholders', async () => {
      const dev = await buildWith({
        NODE_ENV: 'development',
        MSG91_AUTH_KEY: 'placeholder-until-phase-3',
      });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(dev.sendOtp('919999999999', '123456')).resolves.toBeUndefined();

      expect(global.fetch).not.toHaveBeenCalled();
      // The code must be printed in full — a masked one would be useless.
      expect(warn.mock.calls.flat().join(' ')).toContain('123456');
      warn.mockRestore();
    });

    it('still calls MSG91 in production even if a credential looks like a placeholder', async () => {
      const prod = await buildWith({
        NODE_ENV: 'production',
        MSG91_AUTH_KEY: 'placeholder-until-phase-3',
      });
      mockFetchOnce({ ok: true, json: { type: 'success' } });

      await prod.sendOtp('919999999999', '123456');

      // env validation blocks this config from booting production at all; if it
      // ever ran, it must not silently swallow OTPs into a log file.
      expect(global.fetch).toHaveBeenCalled();
    });

    it('calls MSG91 normally when credentials are real', async () => {
      mockFetchOnce({ ok: true, json: { type: 'success' } });

      await service.sendOtp('919999999999', '123456');

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('sendOtp', () => {
    it('calls the MSG91 OTP endpoint with the auth key and a deadline', async () => {
      mockFetchOnce({ ok: true, json: { type: 'success', message: 'OTP sent' } });

      await expect(service.sendOtp('919999999999', '123456')).resolves.toBeUndefined();

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];

      expect(url).toContain('https://control.msg91.com/api/v5/otp');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).authkey).toBe('test_auth_key');
      // No deadline means a stalled MSG91 hangs a checkout indefinitely.
      expect(init.signal).toBeDefined();
    });

    it('throws on a non-ok HTTP response', async () => {
      mockFetchOnce({ ok: false, status: 500, text: 'Internal Server Error' });

      await expect(service.sendOtp('919999999999')).rejects.toThrow(SmsProviderError);
    });

    it('throws when MSG91 reports an error inside a 200 response', async () => {
      // MSG91 signals unapproved templates and blocked numbers this way. A 2xx
      // alone is not proof the OTP was sent.
      mockFetchOnce({
        ok: true,
        json: { type: 'error', message: 'template not approved' },
      });

      await expect(service.sendOtp('919999999999')).rejects.toThrow(/template not approved/);
    });

    it('surfaces a timeout as SmsProviderError, not a raw abort', async () => {
      const timeoutError = new Error('The operation was aborted due to timeout');
      timeoutError.name = 'TimeoutError';
      (global.fetch as jest.Mock).mockRejectedValue(timeoutError);

      const error = (await service
        .sendOtp('919999999999')
        .catch((e: unknown) => e)) as SmsProviderError;

      expect(error).toBeInstanceOf(SmsProviderError);
      expect(error.message).toMatch(/timed out/i);
    });
  });

  describe('verifyOtp', () => {
    it('returns true when MSG91 confirms the code', async () => {
      mockFetchOnce({ ok: true, json: { type: 'success', message: 'OTP verified' } });

      await expect(service.verifyOtp('919999999999', '123456')).resolves.toBe(true);
    });

    it('returns false — does NOT throw — when the code is wrong', async () => {
      // The distinction this test protects: MSG91 answers a bad code with 4xx.
      // If that threw, every mistyped digit would look like an outage to the
      // auth module, and a real outage would be indistinguishable from a user
      // fat-fingering their OTP.
      mockFetchOnce({
        ok: false,
        status: 400,
        json: { type: 'error', message: 'OTP not match' },
      });

      await expect(service.verifyOtp('919999999999', '000000')).resolves.toBe(false);
    });

    it('returns false when the code has expired', async () => {
      mockFetchOnce({
        ok: false,
        status: 400,
        json: { type: 'error', message: 'OTP expired' },
      });

      await expect(service.verifyOtp('919999999999', '123456')).resolves.toBe(false);
    });

    it('throws when MSG91 itself is broken (5xx)', async () => {
      // An outage is our problem, not the buyer's — it must not be reported as
      // "wrong code", which would tell them to retype a correct OTP forever.
      mockFetchOnce({ ok: false, status: 503, json: { message: 'service unavailable' } });

      await expect(service.verifyOtp('919999999999', '123456')).rejects.toThrow(SmsProviderError);
    });

    it('throws when MSG91 is unreachable', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.verifyOtp('919999999999', '123456')).rejects.toThrow(SmsProviderError);
    });
  });

  describe('whatsappNotify', () => {
    it('sends the WhatsApp business number, not the SMS sender ID', async () => {
      mockFetchOnce({ ok: true, json: { type: 'success' } });

      await service.whatsappNotify('919999999999', 'order_confirmed', { body_1: 'ADR-1' });

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string) as { integrated_number: string };

      // These are different identifiers on different channels. Passing the DLT
      // sender header here fails only against a live account.
      expect(payload.integrated_number).toBe('919000000000');
      expect(payload.integrated_number).not.toBe('ADORNI');
    });

    it('throws on a non-ok response', async () => {
      mockFetchOnce({ ok: false, status: 400, text: 'bad template' });

      await expect(service.whatsappNotify('919999999999', 'nope', {})).rejects.toThrow(
        SmsProviderError,
      );
    });
  });
});
