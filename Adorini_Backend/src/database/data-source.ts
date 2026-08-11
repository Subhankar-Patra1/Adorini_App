import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { ENTITIES } from './entities';
import { SnakeNamingStrategy } from './naming.strategy';

/**
 * The TypeORM CLI (`migration:generate`, `migration:run`) and the seed runner
 * boot this file directly, outside Nest — so there is no ConfigModule to read
 * from and the env has to be loaded here. The running application does not use
 * this DataSource; it builds its own options through ConfigService in
 * `database.module.ts`, which keeps env validation in one place.
 */
loadDotenv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env before running database commands.`,
    );
  }
  return value;
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: requireEnv('DATABASE_URL'),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,

  entities: ENTITIES,

  /**
   * Emit `gen_random_uuid()` for UUID primary keys instead of TypeORM's default
   * `uuid_generate_v4()`. The latter needs the `uuid-ossp` extension installed
   * by a superuser — a migration that assumes it fails on a fresh database.
   * `gen_random_uuid()` has been core PostgreSQL since 13, so it needs nothing.
   */
  uuidExtension: 'pgcrypto',

  // Matches both the .ts sources under ts-node and the compiled .js under dist.
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],

  namingStrategy: new SnakeNamingStrategy(),

  /**
   * Never true, in any environment.
   *
   * `synchronize` diffs entities against the live schema and applies the
   * result without review — on a database holding real orders that is a
   * silent-data-loss button. Migrations are the only way schema changes reach
   * a database here, including in development, so what runs in production is
   * what was tested locally.
   */
  synchronize: false,

  logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
};

export const AppDataSource = new DataSource(dataSourceOptions);
