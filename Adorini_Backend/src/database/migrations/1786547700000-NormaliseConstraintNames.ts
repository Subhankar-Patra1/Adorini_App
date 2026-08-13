import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The `AddVideos` and `AddCoupons` migrations named their foreign keys and the
 * coupon-code unique index by hand, using strings shaped like TypeORM hashes
 * but not actually derived from them (`FK_a1b2c3d4e5f6a7b8c9d0e1f2a3b4` is
 * sequential hex, not a digest).
 *
 * TypeORM therefore did not recognise them as its own, and every
 * `migration:generate` proposed dropping and recreating all five constraints.
 * Left alone that is not a correctness problem, but it is a safety one: a drift
 * check that always reports drift is a drift check nobody reads, and the real
 * finding — a missing `idx_orders_delivery_failed_at` on the Order entity — was
 * sitting in exactly that noise.
 *
 * This renames them to the canonical hashes so drift output returns to empty.
 */
export class NormaliseConstraintNames1786547700000 implements MigrationInterface {
  name = 'NormaliseConstraintNames1786547700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_e5f60718293a4b5c6d7e8f902132"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_f60718293a4b5c6d7e8f90213243"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_0718293a4b5c6d7e8f9021324354"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" DROP CONSTRAINT "FK_a1b2c3d4e5f6a7b8c9d0e1f2a3b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" DROP CONSTRAINT "FK_b2c3d4e5f6a7b8c9d0e1f2a3b4c5"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_c1a2b3d4e5f60718293a4b5c6d7"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e025109230e82925843f2a14c4" ON "coupons" ("code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_9df1b9bc48e3eea5da3762f8e56" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_986f8dd830915cf2835f89709df" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_adb70aa4959d5b2676fa4fde836" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" ADD CONSTRAINT "FK_853f70973cd9f0cc8a399d4354e" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" ADD CONSTRAINT "FK_0c5bea424ddf25c56456b937a93" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" DROP CONSTRAINT "FK_0c5bea424ddf25c56456b937a93"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" DROP CONSTRAINT "FK_853f70973cd9f0cc8a399d4354e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_adb70aa4959d5b2676fa4fde836"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_986f8dd830915cf2835f89709df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_9df1b9bc48e3eea5da3762f8e56"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_e025109230e82925843f2a14c4"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c1a2b3d4e5f60718293a4b5c6d7" ON "coupons" ("code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" ADD CONSTRAINT "FK_b2c3d4e5f6a7b8c9d0e1f2a3b4c5" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" ADD CONSTRAINT "FK_a1b2c3d4e5f6a7b8c9d0e1f2a3b4" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_0718293a4b5c6d7e8f9021324354" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_f60718293a4b5c6d7e8f90213243" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_e5f60718293a4b5c6d7e8f902132" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
