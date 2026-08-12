import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReturnRequests1786497488319 implements MigrationInterface {
  name = 'AddReturnRequests1786497488319';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."return_status" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "return_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "order_item_id" uuid NOT NULL, "user_id" uuid NOT NULL, "quantity" integer NOT NULL, "reason" character varying(64) NOT NULL, "comment" text, "fit_tag" "public"."fit_tag", "status" "public"."return_status" NOT NULL DEFAULT 'REQUESTED', "admin_note" text, "resolved_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_return_request_order_item" UNIQUE ("order_item_id"), CONSTRAINT "chk_return_quantity_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_38714de8942bd9bc3a450a06889" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_return_requests_user" ON "return_requests"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_return_requests_status" ON "return_requests"  ("status", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" ADD CONSTRAINT "FK_c7f39dfc32be2b7be25c139ba04" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" ADD CONSTRAINT "FK_b488e0eb089a974ebda907e5519" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" ADD CONSTRAINT "FK_47fa80a304062cb2e2703f1d620" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "return_requests" DROP CONSTRAINT "FK_47fa80a304062cb2e2703f1d620"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" DROP CONSTRAINT "FK_b488e0eb089a974ebda907e5519"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" DROP CONSTRAINT "FK_c7f39dfc32be2b7be25c139ba04"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_return_requests_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_return_requests_user"`);
    await queryRunner.query(`DROP TABLE "return_requests"`);
    await queryRunner.query(`DROP TYPE "public"."return_status"`);
  }
}
