import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MSG91 is dropped entirely in favour of calling Meta's WhatsApp Business
 * Cloud API directly. The `webhook_provider` enum value that used to mean
 * "MSG91's callback" now means "Meta's WhatsApp callback" — same trust
 * boundary (an inbound provider webhook), different provider, so this is a
 * rename rather than a new value living alongside the old one.
 *
 * `RENAME VALUE` (PostgreSQL 10+) is metadata-only: existing
 * `processed_webhooks` rows tagged 'MSG91' become 'WHATSAPP' in place, with no
 * data loss and no need to touch the `uq_processed_webhook_provider_event`
 * constraint or any row data. Unlike `ADD VALUE`, it has no same-transaction
 * restriction, so this runs safely inside TypeORM's wrapping transaction.
 */
export class RenameMsg91WebhookProviderToWhatsapp1787000000000 implements MigrationInterface {
  name = 'RenameMsg91WebhookProviderToWhatsapp1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."webhook_provider" RENAME VALUE 'MSG91' TO 'WHATSAPP'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."webhook_provider" RENAME VALUE 'WHATSAPP' TO 'MSG91'`,
    );
  }
}
