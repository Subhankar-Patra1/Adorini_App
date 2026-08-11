import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { INestApplication } from '@nestjs/common';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ENTITIES } from './database/entities';
import { SnakeNamingStrategy } from './database/naming.strategy';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './common/health/health.module';
import { RedisModule } from './providers/redis/redis.module';

/**
 * Proves the OpenAPI document can actually be generated.
 *
 * This exists because of a real failure: a `z.date()` in a response DTO made
 * `cleanupOpenApiDoc` throw "Date cannot be represented in JSON Schema" — and
 * it threw at **bootstrap**, so the app would not start at all. Every unit and
 * integration test passed; the only thing that caught it was booting the
 * process by hand.
 *
 * Swagger generation is not decoration here. The Flutter client is built from
 * this document (ADR-005), and it runs during bootstrap, so a DTO that cannot
 * be represented in JSON Schema is a total outage rather than a documentation
 * gap. Generating the document in CI moves that from "discovered by running the
 * app" to "discovered by running the tests".
 *
 * It lives in the integration suite because building the module graph needs a
 * database connection, even though nothing here issues a query.
 */
describe('OpenAPI document generation', () => {
  let app: INestApplication;
  let document: ReturnType<typeof cleanupOpenApiDoc>;

  function testDatabaseUrl(): string {
    const base = process.env.DATABASE_URL;
    if (!base) throw new Error('DATABASE_URL is required for integration tests');
    const url = new URL(base);
    url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
    return url.toString();
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: testDatabaseUrl(),
          entities: ENTITIES,
          namingStrategy: new SnakeNamingStrategy(),
          uuidExtension: 'pgcrypto',
          synchronize: false,
          logging: false,
        }),
        RedisModule,
        AuthModule,
        UsersModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    // Mirrors main.ts exactly — testing a different construction would prove
    // nothing about what actually runs at bootstrap.
    const config = new DocumentBuilder()
      .setTitle('Adorini API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  it('generates without throwing', () => {
    // The assertion is really that beforeAll completed: `cleanupOpenApiDoc`
    // throws on any type it cannot express, which is what happened with
    // `z.date()`.
    expect(document).toBeDefined();
    expect(document.openapi).toMatch(/^3\./);
  });

  it('documents every module the client is built against', () => {
    const paths = Object.keys(document.paths);

    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/auth/otp/request',
        '/api/auth/otp/verify',
        '/api/auth/google',
        '/api/auth/refresh',
        '/api/users/me',
        '/api/users/me/addresses',
        '/api/health',
      ]),
    );
  });

  it('exposes the bearer security scheme', () => {
    expect(Object.keys(document.components?.securitySchemes ?? {})).toContain('bearer');
  });

  it('describes Google sign-in as a two-branch union', () => {
    // The PHONE_REQUIRED branch is a normal outcome, not an error (ADR-012).
    // If this collapses to a single schema the client loses the ability to
    // branch on `status` and mobile signup silently breaks.
    const schema = document.paths['/api/auth/google']?.post?.responses?.['200'];

    expect(JSON.stringify(schema)).toContain('oneOf');
  });

  it('has no schema property typed as a bare JS Date', () => {
    // Regression guard for the original bug. A `Date` cannot survive JSON, so
    // its presence anywhere in the document means a DTO is lying about what the
    // client receives — timestamps must be documented as date-time strings.
    const serialised = JSON.stringify(document);

    expect(serialised).not.toContain('"type":"Date"');
    expect(serialised).not.toContain('"format":"Date"');
  });

  it('documents timestamps as ISO date-time strings', () => {
    const addressSchema = document.components?.schemas?.AddressResponseDto;

    expect(JSON.stringify(addressSchema)).toContain('date-time');
  });
});
