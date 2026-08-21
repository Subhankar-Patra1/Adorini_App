import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Search analytics.
 *
 * Records every catalogue search and how many products it returned, so the shop
 * can be merchandised against what shoppers actually ask for — above all the
 * searches that return nothing, which name the stock that is missing.
 *
 * No foreign key to `users`, by design: see the entity for why search terms are
 * kept unattributed.
 */
export class AddSearchQueries1786900000000 implements MigrationInterface {
  name = 'AddSearchQueries1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "search_queries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "term" character varying(120) NOT NULL,
        "normalised_term" character varying(120) NOT NULL,
        "result_count" integer NOT NULL,
        CONSTRAINT "pk_search_queries" PRIMARY KEY ("id"),
        CONSTRAINT "chk_search_result_count_non_negative" CHECK ("result_count" >= 0)
      )
    `);

    // The report groups by the normalised term and windows by date; both
    // columns are indexed because both appear in every query that matters.
    await queryRunner.query(
      `CREATE INDEX "idx_search_queries_normalised" ON "search_queries" ("normalised_term")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_search_queries_created_at" ON "search_queries" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "search_queries"`);
  }
}
