import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ENTITIES } from './entities';
import { SnakeNamingStrategy } from './naming.strategy';
import type { Env } from '../config/env.validation';

/**
 * Wires the application's database connection.
 *
 * Options are built from ConfigService rather than imported from
 * `data-source.ts` so the app has exactly one env-validation path — the Zod
 * schema that already aborts bootstrap on a malformed `DATABASE_URL`.
 * `data-source.ts` exists for the CLI, which runs without Nest.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL', { infer: true }),
        ssl: config.get('DATABASE_SSL', { infer: true }) ? { rejectUnauthorized: false } : false,
        entities: ENTITIES,
        namingStrategy: new SnakeNamingStrategy(),

        // Keep in step with data-source.ts — see the note there.
        uuidExtension: 'pgcrypto' as const,

        // See data-source.ts — migrations are the only path to a schema change.
        synchronize: false,

        // The app must not mutate schema on boot. Railway runs migrations as a
        // deploy step, so two instances starting at once cannot race to apply
        // the same migration.
        migrationsRun: false,

        autoLoadEntities: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
