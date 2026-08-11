import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { OtpService } from './otp.service';
import { RedisService } from '../../../providers/redis/redis.service';

describe('OtpService', () => {
  let service: OtpService;

  let get: jest.Mock;
  let setex: jest.Mock;
  let del: jest.Mock;
  let exists: jest.Mock;
  let incr: jest.Mock;
  let expire: jest.Mock;
  let exec: jest.Mock;
  let ttl: jest.Mock;

  const config: Record<string, string | number> = {
    OTP_TTL_SECONDS: 300,
    OTP_MAX_ATTEMPTS: 5,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
    OTP_MAX_REQUESTS_PER_HOUR: 5,
    JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars',
  };

  /** Sets what the next `INCR` returns. */
  function nextCounter(value: number): void {
    exec.mockResolvedValueOnce([
      [null, value],
      [null, 1],
    ]);
  }

  beforeEach(async () => {
    get = jest.fn().mockResolvedValue(null);
    setex = jest.fn().mockResolvedValue(undefined);
    del = jest.fn().mockResolvedValue(1);
    exists = jest.fn().mockResolvedValue(0);
    incr = jest.fn().mockReturnThis();
    expire = jest.fn().mockReturnThis();
    exec = jest.fn().mockResolvedValue([[null, 1]]);
    ttl = jest.fn().mockResolvedValue(42);

    const multi = { incr, expire, exec };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        {
          provide: RedisService,
          useValue: {
            get,
            setex,
            del,
            exists,
            getClient: () => ({ multi: () => multi, ttl }),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key]) },
        },
      ],
    }).compile();

    service = module.get(OtpService);
  });

  describe('requestOtp', () => {
    it('returns a 6-digit numeric code', async () => {
      nextCounter(1);
      const outcome = await service.requestOtp('919876543210');

      expect(outcome.allowed).toBe(true);
      if (outcome.allowed) {
        expect(outcome.otp).toMatch(/^\d{6}$/);
      }
    });

    it('produces varied codes across many calls', async () => {
      // Guards against a constant or trivially sequential generator. Not a
      // statistical randomness test — just proof it isn't stuck.
      const codes = new Set<string>();

      for (let i = 0; i < 50; i++) {
        nextCounter(1);
        const outcome = await service.requestOtp('919876543210');
        if (outcome.allowed) codes.add(outcome.otp);
      }

      expect(codes.size).toBeGreaterThan(40);
    });

    it('never stores the code in plaintext', async () => {
      nextCounter(1);
      const outcome = await service.requestOtp('919876543210');

      const [key, ttlArg, stored] = setex.mock.calls[0] as [string, number, string];

      expect(key).toBe('otp:code:919876543210');
      expect(ttlArg).toBe(300);
      // HMAC-SHA256 hex, and definitely not the code itself.
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      if (outcome.allowed) {
        expect(stored).not.toContain(outcome.otp);
      }
    });

    it('clears stale attempts so a resend gives a clean slate', async () => {
      // Without this, someone who mistyped five times could request a new code
      // and still be locked out — they would have no way to recover.
      nextCounter(1);
      await service.requestOtp('919876543210');

      expect(del).toHaveBeenCalledWith('otp:attempts:919876543210');
    });

    it('sets the resend cooldown', async () => {
      nextCounter(1);
      await service.requestOtp('919876543210');

      expect(setex).toHaveBeenCalledWith('otp:resend:919876543210', 60, '1');
    });

    it('refuses while the cooldown is active', async () => {
      exists.mockResolvedValue(1);

      const outcome = await service.requestOtp('919876543210');

      expect(outcome).toMatchObject({ allowed: false, reason: 'COOLDOWN' });
      expect(setex).not.toHaveBeenCalled();
    });

    it('refuses past the hourly cap', async () => {
      // Each SMS is a real charge, so this limit protects spend as much as it
      // protects the person whose phone would be ringing.
      nextCounter(6);

      const outcome = await service.requestOtp('919876543210');

      expect(outcome).toMatchObject({ allowed: false, reason: 'HOURLY_LIMIT' });
      expect(setex).not.toHaveBeenCalled();
    });

    it('allows exactly the configured number of sends per hour', async () => {
      nextCounter(5);
      await expect(service.requestOtp('919876543210')).resolves.toMatchObject({
        allowed: true,
      });
    });
  });

  describe('verifyOtp', () => {
    /** Stores a real code so the hash comparison exercises the true path. */
    async function issueCode(phone = '919876543210'): Promise<string> {
      nextCounter(1);
      const outcome = await service.requestOtp(phone);
      if (!outcome.allowed) throw new Error('expected an allowed request');

      const stored = (setex.mock.calls[0] as [string, number, string])[2];
      get.mockResolvedValue(stored);

      return outcome.otp;
    }

    it('accepts the correct code', async () => {
      const otp = await issueCode();
      nextCounter(1);

      await expect(service.verifyOtp('919876543210', otp)).resolves.toEqual({
        valid: true,
      });
    });

    it('destroys the code on success so it cannot be replayed', async () => {
      const otp = await issueCode();
      nextCounter(1);

      await service.verifyOtp('919876543210', otp);

      expect(del).toHaveBeenCalledWith('otp:code:919876543210', 'otp:attempts:919876543210');
    });

    it('rejects a wrong code', async () => {
      await issueCode();
      nextCounter(1);

      await expect(service.verifyOtp('919876543210', '000000')).resolves.toEqual({
        valid: false,
        reason: 'MISMATCH',
      });
    });

    it('reports EXPIRED when no code is stored', async () => {
      // Also covers "never requested one" — deliberately indistinguishable, so
      // the endpoint can't be used to probe which numbers have a code pending.
      get.mockResolvedValue(null);

      await expect(service.verifyOtp('919876543210', '123456')).resolves.toEqual({
        valid: false,
        reason: 'EXPIRED',
      });
    });

    it('destroys the code once attempts are exhausted', async () => {
      // This pairing is what makes a 6-digit secret defensible: guessing is
      // capped, and getting a fresh target costs an SMS that the hourly limit
      // rations.
      await issueCode();
      nextCounter(6);

      await expect(service.verifyOtp('919876543210', '000000')).resolves.toEqual({
        valid: false,
        reason: 'TOO_MANY_ATTEMPTS',
      });
      expect(del).toHaveBeenCalledWith('otp:code:919876543210', 'otp:attempts:919876543210');
    });

    it('still accepts the correct code on the final permitted attempt', async () => {
      const otp = await issueCode();
      nextCounter(5);

      await expect(service.verifyOtp('919876543210', otp)).resolves.toEqual({
        valid: true,
      });
    });

    it('counts the attempt before comparing', async () => {
      // If the counter only incremented on failure-after-compare, a caller
      // could skip it by racing; incrementing first makes every submission cost.
      await issueCode();
      nextCounter(1);

      await service.verifyOtp('919876543210', '000000');

      expect(incr).toHaveBeenCalledWith('otp:attempts:919876543210');
      expect(expire).toHaveBeenCalledWith('otp:attempts:919876543210', 300);
    });
  });
});
