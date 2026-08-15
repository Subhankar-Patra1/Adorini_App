import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-category size bands.
 *
 * Until now every garment shared one band, enforced in the database as
 * `chk_variant_nominal_size_range: "nominal_size" BETWEEN 40 AND 48`. Blouses
 * broke it: they are stocked at 32, 34 and 36, below the floor, so the insert
 * was rejected outright.
 *
 * Widening the shared band to 32–48 would have admitted them but stopped
 * saying anything useful — nothing would then prevent a size-32 kaftaan. The
 * band therefore moves onto the category, which is the thing that actually
 * knows what it stocks.
 *
 * **The check constraint cannot follow it.** A CHECK may not reference another
 * table, so validating a variant against its category's band is now the
 * application's job. This is a real loss of a database-level guarantee and is
 * recorded here so it is not rediscovered as a surprise: the database will
 * accept a size the category does not list. The constraint below is kept only
 * as a coarse backstop against a transposed digit, not as the rule.
 *
 * Scope note: non-numeric sizing ("Free size", "Ankle length") is deliberately
 * **not** part of this. `nominal_size` stays `NOT NULL`, so leggings keep the
 * numeric band for now. That also keeps the uniqueness constraint honest —
 * making the column nullable would have quietly broken it, because Postgres
 * treats NULLs as distinct in a unique index and two "Free size, Black" rows
 * would both have been accepted, splitting one SKU's stock across two records.
 * Whenever labelled sizing does arrive, that is the trap to avoid.
 */
export class AddPerCategorySizeBands1786600000000 implements MigrationInterface {
  name = 'AddPerCategorySizeBands1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Defaulted to the historic band so existing categories keep their current
    // meaning without a data backfill; the seed then narrows the ones that
    // differ. New categories must state their own band explicitly.
    await queryRunner.query(
      `ALTER TABLE "categories" ADD COLUMN "sizes" smallint[] NOT NULL DEFAULT '{40,42,44,46,48}'`,
    );

    // An empty band would mean "this category stocks nothing", which no caller
    // has a sensible answer for — the size picker would render zero options.
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "chk_category_sizes_non_empty" ` +
        `CHECK (array_length("sizes", 1) >= 1)`,
    );

    // Floor widened to 32, ceiling unchanged.
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP CONSTRAINT "chk_variant_nominal_size_range"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD CONSTRAINT "chk_variant_nominal_size_range" ` +
        `CHECK ("nominal_size" BETWEEN 32 AND 48)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Not loss-free, and deliberately loud about it: a blouse variant under
    // size 40 has no representation in the old schema. Rolling back deletes
    // those rows rather than silently coercing them to a size they are not.
    await queryRunner.query(`DELETE FROM "product_variants" WHERE "nominal_size" < 40`);

    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP CONSTRAINT "chk_variant_nominal_size_range"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD CONSTRAINT "chk_variant_nominal_size_range" ` +
        `CHECK ("nominal_size" BETWEEN 40 AND 48)`,
    );

    await queryRunner.query(
      `ALTER TABLE "categories" DROP CONSTRAINT "chk_category_sizes_non_empty"`,
    );
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "sizes"`);
  }
}
