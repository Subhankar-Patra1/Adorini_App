import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVideos1786500000000 implements MigrationInterface {
  name = 'AddVideos1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "object_key" character varying(512) NOT NULL, "thumbnail_key" character varying(512), "caption" text, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_e4b1a3f6f7c9e4d0f3a1c2b3d4e5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_videos_active_created" ON "videos" ("is_active", "created_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "video_product_tags" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "video_id" uuid NOT NULL, "product_id" uuid NOT NULL, "display_order" smallint NOT NULL DEFAULT '0', CONSTRAINT "uq_video_product_tag" UNIQUE ("video_id", "product_id"), CONSTRAINT "PK_f2a3b4c5d6e7f8091a2b3c4d5e6f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_video_product_tags_video" ON "video_product_tags" ("video_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" ADD CONSTRAINT "FK_a1b2c3d4e5f6a7b8c9d0e1f2a3b4" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" ADD CONSTRAINT "FK_b2c3d4e5f6a7b8c9d0e1f2a3b4c5" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" DROP CONSTRAINT "FK_b2c3d4e5f6a7b8c9d0e1f2a3b4c5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_product_tags" DROP CONSTRAINT "FK_a1b2c3d4e5f6a7b8c9d0e1f2a3b4"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_video_product_tags_video"`);
    await queryRunner.query(`DROP TABLE "video_product_tags"`);
    await queryRunner.query(`DROP INDEX "public"."idx_videos_active_created"`);
    await queryRunner.query(`DROP TABLE "videos"`);
  }
}
