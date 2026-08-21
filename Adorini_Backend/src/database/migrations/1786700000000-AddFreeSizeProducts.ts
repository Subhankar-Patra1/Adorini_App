import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Free-size products.
 *
 * Some garments are not sold in a size band at all. The Lyra churidar leggings
 * are the first: one size fits a standard adult range, so a size picker offering
 * 40–48 would be inventing a choice the shopper does not have.
 *
 * **The flag lives on the product, not the category.** Leggings are a single
 * category holding both ankle-length (banded) and free-size stock, so a
 * category-level flag would have to be true or false for a group that is
 * genuinely both.
 *
 * ### Why `nominal_size` stays NOT NULL
 *
 * The obvious move — make `product_variants.nominal_size` nullable and store
 * NULL for free size — is the trap `AddPerCategorySizeBands` warned about.
 * Postgres treats NULLs as distinct in a unique index, so two "Free size, Black"
 * rows would both be accepted and one SKU's stock would split across two
 * records, each with its own count.
 *
 * A free-size product therefore keeps one variant per colour at a canonical
 * `nominal_size` of 40. That number is an artefact of the NOT NULL constraint
 * and carries no meaning: `is_free_size` is the truth, and every reader must
 * branch on the flag rather than on the size. The API omits the size and the app
 * renders a "Free Size" chip in place of the picker.
 */
export class AddFreeSizeProducts1786700000000 implements MigrationInterface {
  name = 'AddFreeSizeProducts1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN "is_free_size" boolean NOT NULL DEFAULT false`,
    );

    // A free-size product with several sizes is a contradiction, and it is the
    // one shape that would put a size picker back in front of the shopper. A
    // CHECK cannot count rows in another table, so this is a trigger — the same
    // limitation, and for the same reason, as the per-category band above.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION assert_free_size_single_size() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM products p
          WHERE p.id = NEW.product_id AND p.is_free_size
        ) AND EXISTS (
          SELECT 1 FROM product_variants v
          WHERE v.product_id = NEW.product_id
            AND v.nominal_size <> NEW.nominal_size
        ) THEN
          RAISE EXCEPTION
            'Product % is free size and cannot stock more than one nominal size',
            NEW.product_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_free_size_single_size
      BEFORE INSERT OR UPDATE ON "product_variants"
      FOR EACH ROW EXECUTE FUNCTION assert_free_size_single_size();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_free_size_single_size ON "product_variants"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS assert_free_size_single_size()`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "is_free_size"`);
  }
}
