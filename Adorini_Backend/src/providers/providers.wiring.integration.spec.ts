import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { LogisticsModule } from './logistics/logistics.module';
import { LogisticsService } from './logistics/logistics.service';
import { OAuthModule } from './oauth/oauth.module';
import { OAuthService } from './oauth/oauth.service';
import { PaymentsModule } from './payments/payments.module';
import { PaymentsService } from './payments/payments.service';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { SmsModule } from './sms/sms.module';
import { SmsService } from './sms/sms.service';
import { StorageModule } from './storage/storage.module';
import { StorageService } from './storage/storage.service';
import { validateEnv } from '../config/env.validation';

/**
 * Proves every provider actually wires under Nest with the real ConfigModule.
 *
 * The unit specs construct each service with a hand-mocked ConfigService, which
 * verifies the logic but not the wiring — a provider missing from its module's
 * `providers`, an unexported service, or a config key that exists in the schema
 * under a different name would all pass those specs and fail at runtime.
 *
 * Nothing imports these modules yet (their consumers are the Phase 4 feature
 * modules), so without this test the first time DI is exercised would be
 * halfway through building `auth`. This is an integration spec because
 * `RedisService` opens a real connection on construction and the env is loaded
 * from `.env`.
 */
describe('provider module wiring', () => {
  const cases: Array<{
    name: string;
    module: unknown;
    service: new (...args: never[]) => object;
  }> = [
    { name: 'RedisModule', module: RedisModule, service: RedisService },
    { name: 'SmsModule', module: SmsModule, service: SmsService },
    { name: 'PaymentsModule', module: PaymentsModule, service: PaymentsService },
    { name: 'LogisticsModule', module: LogisticsModule, service: LogisticsService },
    { name: 'StorageModule', module: StorageModule, service: StorageService },
    { name: 'OAuthModule', module: OAuthModule, service: OAuthService },
  ];

  let compiled: TestingModule | undefined;

  afterEach(async () => {
    // Closes the module, which triggers RedisService.onModuleDestroy and stops
    // the connection leaking into the next test or hanging the runner.
    await compiled?.close();
    compiled = undefined;
  });

  it.each(cases)('$name resolves its service through DI', async ({ module, service }) => {
    compiled = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
        module as never,
      ],
    }).compile();

    expect(compiled.get(service)).toBeInstanceOf(service);
  });

  it('exports its service so a consuming module can inject it', async () => {
    // The Phase 4 shape: a feature module imports the provider module and
    // expects the service to be available. A missing `exports` breaks exactly
    // here and nowhere earlier.
    compiled = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
        SmsModule,
        PaymentsModule,
        LogisticsModule,
        StorageModule,
        OAuthModule,
      ],
    }).compile();

    expect(compiled.get(SmsService)).toBeInstanceOf(SmsService);
    expect(compiled.get(PaymentsService)).toBeInstanceOf(PaymentsService);
    expect(compiled.get(LogisticsService)).toBeInstanceOf(LogisticsService);
    expect(compiled.get(StorageService)).toBeInstanceOf(StorageService);
    expect(compiled.get(OAuthService)).toBeInstanceOf(OAuthService);
  });
});
