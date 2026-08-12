import { Test, type TestingModule } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config as loadDotenv } from 'dotenv';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { INestApplication } from '@nestjs/common';

// This spec reads DATABASE_URL before Nest's ConfigModule has a chance to load
// it, so the env has to be populated here first.
loadDotenv();

/**
 * Proves the OpenAPI document can actually be generated for the whole app.
 *
 * This exists because of a real outage-class bug: a `z.date()` in a response
 * DTO made `cleanupOpenApiDoc` throw "Date cannot be represented in JSON
 * Schema" — at **bootstrap**, so the process would not start. Every unit and
 * integration test passed. The only thing that caught it was booting the app by
 * hand.
 *
 * Swagger generation is not decoration here: it runs during bootstrap and the
 * Flutter client is generated from its output (ADR-005), so a DTO that cannot
 * be expressed in JSON Schema is a total outage, not a documentation gap.
 *
 * It imports the real `AppModule` rather than assembling a subset, so it
 * automatically covers every module anyone adds later. A hand-listed subset
 * would silently stop protecting new modules the moment one was forgotten —
 * which is exactly how the original bug would have slipped through again.
 */
describe('OpenAPI document generation', () => {
  let app: INestApplication;
  let document: ReturnType<typeof cleanupOpenApiDoc>;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    // Point the real AppModule at the test database. Nothing here issues a
    // query, but building the module graph opens a connection, and it must not
    // be the development one.
    const url = new URL(originalDatabaseUrl ?? '');
    url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
    process.env.DATABASE_URL = url.toString();

    // Imported after the env is redirected — AppModule reads config at load.
    const { AppModule } = await import('./app.module');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    // Mirrors main.ts — testing a different construction would prove nothing
    // about what actually happens at bootstrap.
    const config = new DocumentBuilder()
      .setTitle('Adorini API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('generates without throwing', () => {
    // The real assertion is that beforeAll completed at all:
    // `cleanupOpenApiDoc` throws on any type it cannot express.
    expect(document).toBeDefined();
    expect(document.openapi).toMatch(/^3\./);
  });

  it('documents every route the app exposes', () => {
    const paths = Object.keys(document.paths);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/auth/otp/request',
        '/api/auth/otp/verify',
        '/api/auth/google',
        '/api/users/me',
        '/api/health',
      ]),
    );
  });

  it('exposes the bearer security scheme', () => {
    expect(Object.keys(document.components?.securitySchemes ?? {})).toContain('bearer');
  });

  it('describes Google sign-in as a two-branch union', () => {
    // PHONE_REQUIRED is a normal outcome, not an error (ADR-012). If this
    // collapses to a single schema the client loses the ability to branch on
    // `status`, and mobile signup silently breaks.
    const schema = document.paths['/api/auth/google']?.post?.responses?.['200'];

    expect(JSON.stringify(schema)).toContain('oneOf');
  });

  it('has no schema typed as a bare JS Date', () => {
    // Regression guard for the original bug. A `Date` cannot survive JSON, so
    // its presence anywhere means a DTO is misdescribing what clients receive.
    const serialised = JSON.stringify(document);

    expect(serialised).not.toContain('"type":"Date"');
    expect(serialised).not.toContain('"format":"Date"');
  });
});
