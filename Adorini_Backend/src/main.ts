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

  app.enableCors();
  await app.listen(port, '0.0.0.0');

  logger.log(`Adorini API listening on :${port} (${nodeEnv})`);
  if (nodeEnv !== 'production') {
    logger.log(`Swagger UI available at :${port}/docs`);
  }
}

void bootstrap();
