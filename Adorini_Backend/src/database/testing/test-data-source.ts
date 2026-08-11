import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';

import { ENTITIES } from '../entities';
import { SnakeNamingStrategy } from '../naming.strategy';

loadDotenv();

/**
 * Connection for integration tests.
 *
 * Points at a dedicated `adorini_test` database, derived from `DATABASE_URL` so
 * there is one connection string to configure. Tests must never run against the
 * development database — they truncate tables, and a developer losing their
 * seed data every test run is how people stop running tests.
 */
function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) {
    return explicit;
  }

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'Neither TEST_DATABASE_URL nor DATABASE_URL is set. Integration tests need a database.',
    );
  }

  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.toString();
}

export function createTestDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    url: testDatabaseUrl(),
    entities: ENTITIES,
    migrations: [`${__dirname}/../migrations/*{.ts,.js}`],
    namingStrategy: new SnakeNamingStrategy(),
    uuidExtension: 'pgcrypto',
    synchronize: false,
    logging: false,
  });
}

/**
 * Brings the test database up to the current schema using the same migrations
 * that run in production — not `synchronize`. A test suite that builds its
 * schema a different way from production proves the entities are consistent
 * with themselves, which is not the property anyone needs.
 */
export async function initTestDataSource(): Promise<DataSource> {
  const ds = await createTestDataSource().initialize();
  await ds.runMigrations();
  return ds;
}

/** Clears all data between tests while leaving the schema in place. */
export async function truncateAll(ds: DataSource): Promise<void> {
  const tables = ds.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ');
  await ds.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
