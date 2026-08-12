import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoupons1786500100000 implements MigrationInterface {
  name = 'AddCoupons1786500100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."discount_type" AS ENUM('PERCENT', 'FLAT')`);
    await queryRunner.query(
      `CREATE TABLE "coupons" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(32) NOT NULL, "discount_type" "public"."discount_type" NOT NULL, "discount_value" integer NOT NULL, "min_order_paise" integer, "max_discount_paise" integer, "max_redemptions" integer, "valid_from" TIMESTAMP WITH TIME ZONE, "valid_until" TIMESTAMP WITH TIME ZONE, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "chk_coupon_discount_value_positive" CHECK ("discount_value" > 0), CONSTRAINT "chk_coupon_percent_range" CHECK ("discount_type" <> 'PERCENT' OR "discount_value" <= 100), CONSTRAINT "PK_c30bcd83e845b1b389b2879ee7e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c1a2b3d4e5f60718293a4b5c6d7" ON "coupons" ("code")`);
    await queryRunner.query(
      `CREATE TABLE "coupon_redemptions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "coupon_id" uuid NOT NULL, "user_id" uuid NOT NULL, "order_id" uuid NOT NULL, "discount_applied_paise" integer NOT NULL, CONSTRAINT "uq_coupon_redemption_coupon_user" UNIQUE ("coupon_id", "user_id"), CONSTRAINT "PK_d4e5f60718293a4b5c6d7e8f9021" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_coupon_redemptions_coupon" ON "coupon_redemptions" ("coupon_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_e5f60718293a4b5c6d7e8f902132" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_f60718293a4b5c6d7e8f90213243" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_0718293a4b5c6d7e8f9021324354" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_0718293a4b5c6d7e8f9021324354"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_f60718293a4b5c6d7e8f90213243"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_e5f60718293a4b5c6d7e8f902132"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_coupon_redemptions_coupon"`);
    await queryRunner.query(`DROP TABLE "coupon_redemptions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c1a2b3d4e5f60718293a4b5c6d7"`);
    await queryRunner.query(`DROP TABLE "coupons"`);
    await queryRunner.query(`DROP TYPE "public"."discount_type"`);
  }
}
