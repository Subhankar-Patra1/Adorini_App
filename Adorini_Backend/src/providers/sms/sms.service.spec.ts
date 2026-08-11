import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SmsService, SmsProviderError } from './sms.service';

describe('SmsService', () => {
  let service: SmsService;
  const globalFetchBackup = global.fetch;

  beforeEach(async () => {
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              switch (key) {
                case 'MSG91_AUTH_KEY':
                  return 'test_auth_key';
                case 'MSG91_OTP_TEMPLATE_ID':
                  return 'test_template_id';
                case 'MSG91_SENDER_ID':
                  return 'ADORNI';
                default:
                  return '';
              }
            }),
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

  describe('sendOtp', () => {
    it('should call MSG91 OTP endpoint and succeed', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ type: 'success', message: 'OTP sent' }),
      });

      await expect(service.sendOtp('919999999999', '123456')).resolves.not.toThrow();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://control.msg91.com/api/v5/otp/request'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ authkey: 'test_auth_key' }),
        }),
      );
    });

    it('should throw SmsProviderError on non-ok HTTP response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(service.sendOtp('919999999999')).rejects.toThrow(SmsProviderError);
    });
  });

  describe('verifyOtp', () => {
    it('should return true when MSG91 returns success', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ type: 'success', message: 'OTP verified' }),
      });

      const result = await service.verifyOtp('919999999999', '123456');
      expect(result).toBe(true);
    });
  });
});
