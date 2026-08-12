import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Failed-delivery handling: a new order status plus the columns that bound the
 * reattempt cycle and decouple restocking from cancellation.
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block in older
 * PostgreSQL, and TypeORM wraps migrations in one. PostgreSQL 12+ permits it
 * as long as the new value is not used in the same transaction — which it is
 * not here, since the backfill below only touches columns.
 */
export class AddDeliveryFailureHandling1786500200000 implements MigrationInterface {
  name = 'AddDeliveryFailureHandling1786500200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."order_status" ADD VALUE IF NOT EXISTS 'DELIVERY_FAILED' BEFORE 'DELIVERED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN "delivery_attempts" smallint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN "last_delivery_failed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN "restocked_at" TIMESTAMP WITH TIME ZONE`,
    );

    /**
     * Existing cancelled orders were restocked at cancellation under the old
     * behaviour, so stamp them as restocked rather than leaving them looking
     * like they are still owed a restock — a future sweep must not double-count
     * inventory that already went back on the shelf.
     */
    await queryRunner.query(
      `UPDATE "orders" SET "restocked_at" = "cancelled_at" WHERE "status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL`,
    );

    // Drives the response-window sweep, which scans by status + failure time.
    await queryRunner.query(
      `CREATE INDEX "idx_orders_delivery_failed_at" ON "orders" ("status", "last_delivery_failed_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_orders_delivery_failed_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "restocked_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "last_delivery_failed_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "delivery_attempts"`);

    /**
     * PostgreSQL cannot drop a single enum value. Reversing this means
     * recreating the type without `DELIVERY_FAILED`, which requires every
     * order currently in that status to be moved somewhere valid first —
     * `CANCELLED` is the honest landing place, since a rollback abandons the
     * reattempt flow that would have resolved them.
     */
    await queryRunner.query(
      `UPDATE "orders" SET "status" = 'CANCELLED', "cancellation_reason" = COALESCE("cancellation_reason", 'Delivery-failure handling rolled back') WHERE "status" = 'DELIVERY_FAILED'`,
    );
    await queryRunner.query(`ALTER TYPE "public"."order_status" RENAME TO "order_status_old"`);
    await queryRunner.query(
      `CREATE TYPE "public"."order_status" AS ENUM('ORDERED', 'PENDING_VERIFICATION', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "public"."order_status" USING "status"::text::"public"."order_status", ALTER COLUMN "status" SET DEFAULT 'ORDERED'`,
    );
    await queryRunner.query(`DROP TYPE "public"."order_status_old"`);
  }
}
