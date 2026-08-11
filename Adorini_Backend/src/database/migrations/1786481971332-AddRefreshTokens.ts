import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokens1786481971332 implements MigrationInterface {
  name = 'AddRefreshTokens1786481971332';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "token_hash" character(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "replaced_by_hash" character(64), "user_agent" character varying(255), "ip_address" character varying(45), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a7838d2ba25be1342091b6695f" ON "refresh_tokens"  ("token_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_active" ON "refresh_tokens"  ("user_id", "revoked_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_refresh_tokens_user_active"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a7838d2ba25be1342091b6695f"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
