import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Full-text search for the catalog module. Deliberately deferred out of the
 * Phase 2 `InitialSchema` migration (see STATE.md) since it is catalog-specific
 * rather than core data-model shape.
 *
 * `search_vector` is maintained by a trigger, not by the ORM: it is written on
 * every INSERT/UPDATE of `name`/`description` and only ever read via raw
 * `@@ to_tsquery(...)` in CatalogService, so it is intentionally absent from
 * the `Product` entity — there is nothing for TypeORM to hydrate.
 */
export class AddProductSearchVector1786403951398 implements MigrationInterface {
  name = 'AddProductSearchVector1786403951398';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN "search_vector" tsvector`);

    await queryRunner.query(`
      CREATE FUNCTION "products_search_vector_update"() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('english', coalesce(NEW.name, '') || ' ' || coalesce(NEW.description, ''));
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_products_search_vector"
      BEFORE INSERT OR UPDATE OF "name", "description" ON "products"
      FOR EACH ROW EXECUTE FUNCTION "products_search_vector_update"();
    `);

    await queryRunner.query(`
      UPDATE "products" SET "search_vector" = to_tsvector('english', coalesce("name", '') || ' ' || coalesce("description", ''))
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_products_search_vector" ON "products" USING GIN ("search_vector")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_products_search_vector"`);
    await queryRunner.query(`DROP TRIGGER "trg_products_search_vector" ON "products"`);
    await queryRunner.query(`DROP FUNCTION "products_search_vector_update"()`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "search_vector"`);
  }
}
