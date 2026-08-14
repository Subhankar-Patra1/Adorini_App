import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';

import { AppModule } from './app.module';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  /**
   * `rawBody` retains the unparsed request body alongside the parsed one.
   *
   * Cashfree signs the exact bytes it sent, so verifying against a
   * re-serialised `JSON.stringify(body)` fails on any key-order or whitespace
   * difference — and a webhook verifier that fails intermittently is worse than
   * none, because the retries look like an outage.
   */
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

  const apiPrefix = config.get('API_PREFIX', { infer: true });
  const port = config.get('PORT', { infer: true });
  const nodeEnv = config.get('NODE_ENV', { infer: true });

  app.setGlobalPrefix(apiPrefix);
  app.use(helmet());
  app.enableShutdownHooks();

  // Zod is the single validation system (see ADR-006) — NestJS's stock
  // ValidationPipe is class-validator based and deliberately not used.
  app.useGlobalPipes(new ZodValidationPipe());

  // Swagger is the contract the Flutter client is built against (see ADR-005),
  // so it ships in every non-production environment.
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Adorini API')
      .setDescription(
        'Ethnic wear commerce platform — catalog, fabric-specific sizing, COD checkout, referrals.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    // cleanupOpenApiDoc() resolves Zod-derived schemas into real OpenAPI
    // definitions — this document is the contract Flutter is built against.
    const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, swaggerConfig));
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  /**
   * CORS is a *browser* mechanism — the Flutter mobile client is not subject to
   * it and needs none of this. So the allow-list is empty unless someone opts
   * in, and a bare `enableCors()` (which reflects any origin back) is
   * deliberately not used: it would let every site on the internet issue
   * credentialed calls to this API for no benefit to the app that actually
   * ships.
   *
   * In development the localhost origins are allowed regardless, so Swagger UI
   * and a `flutter run -d chrome` session work without configuration.
   */
  const configuredOrigins = config.get('CORS_ALLOWED_ORIGINS', { infer: true });
  const devOrigins =
    nodeEnv === 'production'
      ? []
      : [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
  const allowedOrigins = [...configuredOrigins, ...devOrigins];

  if (allowedOrigins.length > 0) {
    app.enableCors({ origin: allowedOrigins, credentials: true });
    logger.log(`CORS enabled for: ${configuredOrigins.join(', ') || 'localhost (dev only)'}`);
  }

  /**
   * Binding 0.0.0.0 rather than the default loopback is what lets an Android
   * emulator reach the host through 10.0.2.2, and a physical device reach it
   * over the LAN.
   */
  await app.listen(port, '0.0.0.0');

  logger.log(`Adorini API listening on :${port} (${nodeEnv})`);
  if (nodeEnv !== 'production') {
    logger.log(`Swagger UI available at :${port}/docs`);
  }
}

void bootstrap();
