import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen the product search index beyond name + description.
 *
 * The original vector covered only those two columns, which produced three
 * failures a shopper would read as "this shop has nothing":
 *
 * - `kaftaan` → **0 results**, with two kaftaans in stock. They are named
 *   "Kaftan" (one 'a'); the shopper typed the category name as the app spells
 *   it. Indexing the category fixes this without a synonym dictionary.
 * - `navranga` → **0 results**, with 22 products by that brand.
 * - `teal` → missed variants whose colour never appeared in the description.
 *
 * ### Weights
 *
 * `setweight` labels each source A-D so relevance ranking is possible later
 * (`ts_rank` reads these). A name match must outrank a colour match: someone
 * searching "black" wants black garments, not every product that happens to
 * stock a black variant.
 *
 *   A  name            the product itself
 *   B  category, brand  the taxonomy a shopper browses by
 *   C  description      prose, dilute by nature
 *   D  colours, print   attributes, weakest signal
 *
 * ### Why three triggers
 *
 * The vector now denormalises four other tables, so anything that changes them
 * must reindex the affected products. Renames are rare but they do happen — the
 * whole taxonomy was renamed the day before this migration ("Kurtis" → "Kurti"),
 * and without the category trigger every product would have kept the stale word
 * in its index until someone next touched the row.
 */
export class WidenProductSearchVector1786800000000 implements MigrationInterface {
  name = 'WidenProductSearchVector1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Recomputes one product's vector from scratch. Every trigger below routes
    // through this so the definition of "the index" exists exactly once.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION product_search_document(p_product_id uuid) RETURNS tsvector AS $$
        SELECT
          setweight(to_tsvector('english', coalesce(p.name, '')), 'A') ||
          setweight(to_tsvector('english',
            coalesce(c.name, '') || ' ' || coalesce(b.name, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(p.description, '')), 'C') ||
          setweight(to_tsvector('english',
            coalesce(p.print_technique::text, '') || ' ' ||
            coalesce((
              SELECT string_agg(DISTINCT v.colour, ' ')
              FROM product_variants v
              WHERE v.product_id = p.id
            ), '')), 'D')
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.id = p_product_id;
      $$ LANGUAGE sql STABLE;
    `);

    // Products: the row is still being written, so its own columns come from
    // NEW while the joined names are read live.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce((
            SELECT c.name FROM categories c WHERE c.id = NEW.category_id
          ), '') || ' ' || coalesce((
            SELECT b.name FROM brands b WHERE b.id = NEW.brand_id
          ), '')), 'B') ||
          setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C') ||
          setweight(to_tsvector('english',
            coalesce(NEW.print_technique::text, '') || ' ' ||
            coalesce((
              SELECT string_agg(DISTINCT v.colour, ' ')
              FROM product_variants v
              WHERE v.product_id = NEW.id
            ), '')), 'D');
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    `);

    // The old trigger fired only on name/description. Category, brand and
    // print technique are now indexed, so a recategorised product must reindex.
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_products_search_vector" ON "products"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_products_search_vector"
      BEFORE INSERT OR UPDATE OF "name", "description", "category_id", "brand_id", "print_technique"
      ON "products"
      FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();
    `);

    // Variants carry colour. AFTER, not BEFORE: this updates a *different* row.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION variant_reindex_product() RETURNS trigger AS $$
      DECLARE
        target uuid := COALESCE(NEW.product_id, OLD.product_id);
      BEGIN
        UPDATE products SET search_vector = product_search_document(target) WHERE id = target;
        RETURN NULL;
      END
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_variant_reindex_product"
      AFTER INSERT OR UPDATE OF "colour" OR DELETE ON "product_variants"
      FOR EACH ROW EXECUTE FUNCTION variant_reindex_product();
    `);

    // A category or brand rename must sweep its products.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION category_reindex_products() RETURNS trigger AS $$
      BEGIN
        UPDATE products SET search_vector = product_search_document(id) WHERE category_id = NEW.id;
        RETURN NULL;
      END
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_category_reindex_products"
      AFTER UPDATE OF "name" ON "categories"
      FOR EACH ROW WHEN (OLD."name" IS DISTINCT FROM NEW."name")
      EXECUTE FUNCTION category_reindex_products();
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION brand_reindex_products() RETURNS trigger AS $$
      BEGIN
        UPDATE products SET search_vector = product_search_document(id) WHERE brand_id = NEW.id;
        RETURN NULL;
      END
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_brand_reindex_products"
      AFTER UPDATE OF "name" ON "brands"
      FOR EACH ROW WHEN (OLD."name" IS DISTINCT FROM NEW."name")
      EXECUTE FUNCTION brand_reindex_products();
    `);

    // Backfill: existing rows still hold the narrow vector.
    await queryRunner.query(`UPDATE "products" SET "search_vector" = product_search_document("id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_brand_reindex_products" ON "brands"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_category_reindex_products" ON "categories"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_variant_reindex_product" ON "product_variants"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS brand_reindex_products()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS category_reindex_products()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS variant_reindex_product()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS product_search_document(uuid)`);

    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_products_search_vector" ON "products"`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "products_search_vector_update"() RETURNS trigger AS $$
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
    await queryRunner.query(
      `UPDATE "products" SET "search_vector" = to_tsvector('english', coalesce("name", '') || ' ' || coalesce("description", ''))`,
    );
  }
}
