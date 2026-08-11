import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1786403950398 implements MigrationInterface {
  name = 'InitialSchema1786403950398';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "addresses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "recipient_name" character varying(120) NOT NULL, "recipient_phone" character varying(15) NOT NULL, "line1" character varying(255) NOT NULL, "line2" character varying(255), "city" character varying(100) NOT NULL, "state" character varying(100) NOT NULL, "pincode" character(6) NOT NULL, "is_default" boolean NOT NULL DEFAULT false, CONSTRAINT "chk_address_pincode_format" CHECK ("pincode" ~ '^[1-9][0-9]{5}$'), CONSTRAINT "PK_745d8f43d3af10ab8247465e450" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_16aac8a9f6f9c1dd6bcb75ec02" ON "addresses"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "brands" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "slug" character varying(64) NOT NULL, "name" character varying(120) NOT NULL, "description" text, "logo_key" character varying(512), "display_order" smallint NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_b0c437120b624da1034a81fc561" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b15428f362be2200922952dc26" ON "brands"  ("slug") `,
    );
    await queryRunner.query(
      `CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "slug" character varying(64) NOT NULL, "name" character varying(120) NOT NULL, "description" text, "display_order" smallint NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_420d9f679d41281f282f5bc7d0" ON "categories"  ("slug") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."media_type" AS ENUM('IMAGE', 'VIDEO')`);
    await queryRunner.query(`CREATE TYPE "public"."media_provenance" AS ENUM('ADMIN', 'BUYER')`);
    await queryRunner.query(
      `CREATE TABLE "media_assets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "product_id" uuid NOT NULL, "object_key" character varying(512) NOT NULL, "type" "public"."media_type" NOT NULL, "provenance" "public"."media_provenance" NOT NULL, "uploaded_by_user_id" uuid, "review_id" uuid, "display_order" smallint NOT NULL DEFAULT '0', "alt_text" character varying(200), CONSTRAINT "chk_media_buyer_has_uploader" CHECK (("provenance" = 'ADMIN' AND "review_id" IS NULL) OR ("provenance" = 'BUYER' AND "uploaded_by_user_id" IS NOT NULL)), CONSTRAINT "PK_ca47e9f67a5e5d8af1e75d66ee6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_media_product_provenance" ON "media_assets"  ("product_id", "provenance") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."order_status" AS ENUM('ORDERED', 'PENDING_VERIFICATION', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."payment_method" AS ENUM('COD', 'UPI', 'CARD')`);
    await queryRunner.query(
      `CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_number" character varying(32) NOT NULL, "user_id" uuid NOT NULL, "status" "public"."order_status" NOT NULL DEFAULT 'ORDERED', "payment_method" "public"."payment_method" NOT NULL, "payment_status" "public"."payment_status" NOT NULL DEFAULT 'PENDING', "shipping_address" jsonb NOT NULL, "subtotal_paise" integer NOT NULL, "discount_paise" integer NOT NULL DEFAULT '0', "delivery_fee_paise" integer NOT NULL DEFAULT '0', "wallet_credit_paise" integer NOT NULL DEFAULT '0', "total_paise" integer NOT NULL, "cashfree_order_id" character varying(128), "delhivery_waybill" character varying(64), "cod_verified_at" TIMESTAMP WITH TIME ZONE, "shipped_at" TIMESTAMP WITH TIME ZONE, "delivered_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancellation_reason" character varying(255), CONSTRAINT "chk_order_amounts_non_negative" CHECK ("subtotal_paise" >= 0 AND "discount_paise" >= 0 AND "delivery_fee_paise" >= 0 AND "wallet_credit_paise" >= 0 AND "total_paise" >= 0), CONSTRAINT "chk_order_totals_consistent" CHECK ("total_paise" = "subtotal_paise" - "discount_paise" + "delivery_fee_paise" - "wallet_credit_paise"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_75eba1c6b1a66b09f2a97e6927" ON "orders"  ("order_number") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f5b4e190c974e40736acb87534" ON "orders"  ("cashfree_order_id") WHERE cashfree_order_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_da73b91d7d3a0367e782bc341c" ON "orders"  ("delhivery_waybill") WHERE delhivery_waybill IS NOT NULL`,
    );
    await queryRunner.query(`CREATE INDEX "idx_orders_status" ON "orders"  ("status") `);
    await queryRunner.query(
      `CREATE INDEX "idx_orders_user_created" ON "orders"  ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "order_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "variant_id" uuid, "product_id" uuid, "product_name" character varying(200) NOT NULL, "sku" character varying(64) NOT NULL, "nominal_size" smallint NOT NULL, "colour" character varying(64) NOT NULL, "unit_price_paise" integer NOT NULL, "quantity" integer NOT NULL, "line_total_paise" integer NOT NULL, CONSTRAINT "chk_order_item_line_total" CHECK ("line_total_paise" = "unit_price_paise" * "quantity"), CONSTRAINT "chk_order_item_quantity_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_order_items_order" ON "order_items"  ("order_id") `);
    await queryRunner.query(
      `CREATE TYPE "public"."webhook_provider" AS ENUM('CASHFREE', 'DELHIVERY', 'MSG91')`,
    );
    await queryRunner.query(
      `CREATE TABLE "processed_webhooks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "webhook_provider" "public"."webhook_provider" NOT NULL, "webhook_event_id" character varying(255) NOT NULL, "event_type" character varying(128), "payload" jsonb, "related_entity_id" uuid, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_processed_webhook_provider_event" UNIQUE ("webhook_provider", "webhook_event_id"), CONSTRAINT "PK_424a5b387ca6f55edb0238218ec" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_processed_webhooks_received" ON "processed_webhooks"  ("received_at") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."fabric_type" AS ENUM('STRETCH', 'RIGID')`);
    await queryRunner.query(
      `CREATE TYPE "public"."print_technique" AS ENUM('KALANKARI', 'AJRAK', 'BATIK', 'APLIK', 'FANCY')`,
    );
    await queryRunner.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "slug" character varying(160) NOT NULL, "name" character varying(200) NOT NULL, "description" text, "category_id" uuid NOT NULL, "brand_id" uuid NOT NULL, "price_paise" integer NOT NULL, "compare_at_price_paise" integer, "fabric_type" "public"."fabric_type" NOT NULL, "print_technique" "public"."print_technique", "size_rules" jsonb, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "chk_product_compare_at_price" CHECK ("compare_at_price_paise" IS NULL OR "compare_at_price_paise" >= "price_paise"), CONSTRAINT "chk_product_price_positive" CHECK ("price_paise" > 0), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_464f927ae360106b783ed0b410" ON "products"  ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_products_fabric_type" ON "products"  ("fabric_type") `,
    );
    await queryRunner.query(`CREATE INDEX "idx_products_brand" ON "products"  ("brand_id") `);
    await queryRunner.query(
      `CREATE INDEX "idx_products_category_price" ON "products"  ("category_id", "price_paise") `,
    );
    await queryRunner.query(
      `CREATE TABLE "product_variants" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "product_id" uuid NOT NULL, "sku" character varying(64) NOT NULL, "nominal_size" smallint NOT NULL, "colour" character varying(64) NOT NULL, "price_paise" integer, "stock_quantity" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "uq_variant_product_size_colour" UNIQUE ("product_id", "nominal_size", "colour"), CONSTRAINT "chk_variant_price_positive" CHECK ("price_paise" IS NULL OR "price_paise" > 0), CONSTRAINT "chk_variant_nominal_size_range" CHECK ("nominal_size" BETWEEN 40 AND 48), CONSTRAINT "chk_variant_stock_non_negative" CHECK ("stock_quantity" >= 0), CONSTRAINT "PK_281e3f2c55652d6a22c0aa59fd7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6343513e20e2deab45edfce131" ON "product_variants"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_46f236f21640f9da218a063a86" ON "product_variants"  ("sku") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."referral_status" AS ENUM('PENDING', 'CREDITED', 'VOID')`,
    );
    await queryRunner.query(
      `CREATE TABLE "referrals" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "referrer_id" uuid, "referee_id" uuid, "referee_phone" character varying(15) NOT NULL, "status" "public"."referral_status" NOT NULL DEFAULT 'PENDING', "credit_paise" integer NOT NULL, "qualifying_order_id" uuid, "credited_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_referral_referee_phone" UNIQUE ("referee_phone"), CONSTRAINT "chk_referral_no_self_referral" CHECK ("referrer_id" <> "referee_id"), CONSTRAINT "PK_ea9980e34f738b6252817326c08" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_referrals_referrer_status" ON "referrals"  ("referrer_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."fit_tag" AS ENUM('RUNS_SMALL', 'TRUE_TO_SIZE', 'RUNS_LARGE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "reviews" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "product_id" uuid NOT NULL, "user_id" uuid NOT NULL, "rating" smallint NOT NULL, "body" text, "fit_tag" "public"."fit_tag", "purchased_nominal_size" smallint, "is_verified_purchase" boolean NOT NULL DEFAULT false, CONSTRAINT "uq_review_user_product" UNIQUE ("user_id", "product_id"), CONSTRAINT "chk_review_rating_range" CHECK ("rating" BETWEEN 1 AND 5), CONSTRAINT "PK_231ae565c273ee700b283f15c1d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_reviews_product_fit_tag" ON "reviews"  ("product_id", "fit_tag") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."size_enquiry_status" AS ENUM('OPEN', 'RESPONDED', 'CLOSED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "size_enquiries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "product_id" uuid NOT NULL, "user_id" uuid, "requested_size" character varying(32) NOT NULL, "contact_phone" character varying(15) NOT NULL, "message" text, "status" "public"."size_enquiry_status" NOT NULL DEFAULT 'OPEN', "admin_response" text, CONSTRAINT "PK_346e33ec265a63b0773e1a85848" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_235f76fd99ce6d8c80b122b08e" ON "size_enquiries"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_size_enquiries_status" ON "size_enquiries"  ("status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "phone" character varying(15) NOT NULL, "email" character varying(320), "full_name" character varying(120), "gender" character varying(32), "profile_photo_key" character varying(512), "google_id" character varying(255), "is_phone_verified" boolean NOT NULL DEFAULT false, "is_admin" boolean NOT NULL DEFAULT false, "referral_code" character varying(16), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a000cca60bcf04454e72769949" ON "users"  ("phone") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3be5894c040bc2b1930b041262" ON "users"  ("email") WHERE email IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_78fc39f802db8d5b2c0d7d234a" ON "users"  ("google_id") WHERE google_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e6ffdd8cbfbaf70f9689d63e1a" ON "users"  ("referral_code") WHERE referral_code IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "wallets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "balance_paise" integer NOT NULL DEFAULT '0', CONSTRAINT "UQ_92558c08091598f7a4439586cda" UNIQUE ("user_id"), CONSTRAINT "REL_92558c08091598f7a4439586cd" UNIQUE ("user_id"), CONSTRAINT "chk_wallet_balance_non_negative" CHECK ("balance_paise" >= 0), CONSTRAINT "PK_8402e5df5a30a229380e83e4f7e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."wallet_transaction_type" AS ENUM('REFERRAL_CREDIT', 'ORDER_DEBIT', 'REFUND_CREDIT', 'ADMIN_ADJUSTMENT')`,
    );
    await queryRunner.query(`CREATE TABLE "wallet_transactions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "wallet_id" uuid NOT NULL, "type" "public"."wallet_transaction_type" NOT NULL, "amount_paise" integer NOT NULL, "balance_after_paise" integer NOT NULL, "reference_id" uuid, "description" character varying(255), CONSTRAINT "chk_wallet_txn_sign_matches_type" CHECK (("type" IN ('REFERRAL_CREDIT', 'REFUND_CREDIT') AND "amount_paise" > 0)
   OR ("type" = 'ORDER_DEBIT' AND "amount_paise" < 0)
   OR "type" = 'ADMIN_ADJUSTMENT'), CONSTRAINT "chk_wallet_txn_amount_non_zero" CHECK ("amount_paise" <> 0), CONSTRAINT "PK_5120f131bde2cda940ec1a621db" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_wallet_txn_wallet_created" ON "wallet_transactions"  ("wallet_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "addresses" ADD CONSTRAINT "FK_16aac8a9f6f9c1dd6bcb75ec023" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_assets" ADD CONSTRAINT "FK_c7a2d04073a7c613ae48d924915" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_assets" ADD CONSTRAINT "FK_11cbfeb78f50980c28cc3bc5d47" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_assets" ADD CONSTRAINT "FK_436f6f9fa2313f1fdb080e6290d" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_a922b820eeef29ac1c6800e826a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_db2d0ea722e16e0fe8ab3bce111" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_9a5f6868c96e0069e699f33e124" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_1530a6f15d3c79d1b70be98f2be" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD CONSTRAINT "FK_6343513e20e2deab45edfce1316" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referrals" ADD CONSTRAINT "FK_18af9fcaffac6d6d3b28130e149" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referrals" ADD CONSTRAINT "FK_3703ae83894cb2e054d405b9273" FOREIGN KEY ("referee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referrals" ADD CONSTRAINT "FK_23b7744502e48e219aafd90c0c3" FOREIGN KEY ("qualifying_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" ADD CONSTRAINT "FK_9482e9567d8dcc2bc615981ef44" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" ADD CONSTRAINT "FK_728447781a30bc3fcfe5c2f1cdf" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "size_enquiries" ADD CONSTRAINT "FK_235f76fd99ce6d8c80b122b08ef" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "size_enquiries" ADD CONSTRAINT "FK_d7dc0c2cf541158f09d45b2a234" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD CONSTRAINT "FK_92558c08091598f7a4439586cda" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD CONSTRAINT "FK_c57d19129968160f4db28fc8b28" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP CONSTRAINT "FK_c57d19129968160f4db28fc8b28"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP CONSTRAINT "FK_92558c08091598f7a4439586cda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "size_enquiries" DROP CONSTRAINT "FK_d7dc0c2cf541158f09d45b2a234"`,
    );
    await queryRunner.query(
      `ALTER TABLE "size_enquiries" DROP CONSTRAINT "FK_235f76fd99ce6d8c80b122b08ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" DROP CONSTRAINT "FK_728447781a30bc3fcfe5c2f1cdf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviews" DROP CONSTRAINT "FK_9482e9567d8dcc2bc615981ef44"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referrals" DROP CONSTRAINT "FK_23b7744502e48e219aafd90c0c3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referrals" DROP CONSTRAINT "FK_3703ae83894cb2e054d405b9273"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referrals" DROP CONSTRAINT "FK_18af9fcaffac6d6d3b28130e149"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP CONSTRAINT "FK_6343513e20e2deab45edfce1316"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_1530a6f15d3c79d1b70be98f2be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_9a5f6868c96e0069e699f33e124"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "FK_db2d0ea722e16e0fe8ab3bce111"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_a922b820eeef29ac1c6800e826a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_assets" DROP CONSTRAINT "FK_436f6f9fa2313f1fdb080e6290d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_assets" DROP CONSTRAINT "FK_11cbfeb78f50980c28cc3bc5d47"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_assets" DROP CONSTRAINT "FK_c7a2d04073a7c613ae48d924915"`,
    );
    await queryRunner.query(
      `ALTER TABLE "addresses" DROP CONSTRAINT "FK_16aac8a9f6f9c1dd6bcb75ec023"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_wallet_txn_wallet_created"`);
    await queryRunner.query(`DROP TABLE "wallet_transactions"`);
    await queryRunner.query(`DROP TYPE "public"."wallet_transaction_type"`);
    await queryRunner.query(`DROP TABLE "wallets"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e6ffdd8cbfbaf70f9689d63e1a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_78fc39f802db8d5b2c0d7d234a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3be5894c040bc2b1930b041262"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a000cca60bcf04454e72769949"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP INDEX "public"."idx_size_enquiries_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_235f76fd99ce6d8c80b122b08e"`);
    await queryRunner.query(`DROP TABLE "size_enquiries"`);
    await queryRunner.query(`DROP TYPE "public"."size_enquiry_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_reviews_product_fit_tag"`);
    await queryRunner.query(`DROP TABLE "reviews"`);
    await queryRunner.query(`DROP TYPE "public"."fit_tag"`);
    await queryRunner.query(`DROP INDEX "public"."idx_referrals_referrer_status"`);
    await queryRunner.query(`DROP TABLE "referrals"`);
    await queryRunner.query(`DROP TYPE "public"."referral_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_46f236f21640f9da218a063a86"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6343513e20e2deab45edfce131"`);
    await queryRunner.query(`DROP TABLE "product_variants"`);
    await queryRunner.query(`DROP INDEX "public"."idx_products_category_price"`);
    await queryRunner.query(`DROP INDEX "public"."idx_products_brand"`);
    await queryRunner.query(`DROP INDEX "public"."idx_products_fabric_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_464f927ae360106b783ed0b410"`);
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP TYPE "public"."print_technique"`);
    await queryRunner.query(`DROP TYPE "public"."fabric_type"`);
    await queryRunner.query(`DROP INDEX "public"."idx_processed_webhooks_received"`);
    await queryRunner.query(`DROP TABLE "processed_webhooks"`);
    await queryRunner.query(`DROP TYPE "public"."webhook_provider"`);
    await queryRunner.query(`DROP INDEX "public"."idx_order_items_order"`);
    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP INDEX "public"."idx_orders_user_created"`);
    await queryRunner.query(`DROP INDEX "public"."idx_orders_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_da73b91d7d3a0367e782bc341c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f5b4e190c974e40736acb87534"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_75eba1c6b1a66b09f2a97e6927"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TYPE "public"."payment_status"`);
    await queryRunner.query(`DROP TYPE "public"."payment_method"`);
    await queryRunner.query(`DROP TYPE "public"."order_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_media_product_provenance"`);
    await queryRunner.query(`DROP TABLE "media_assets"`);
    await queryRunner.query(`DROP TYPE "public"."media_provenance"`);
    await queryRunner.query(`DROP TYPE "public"."media_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_420d9f679d41281f282f5bc7d0"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b15428f362be2200922952dc26"`);
    await queryRunner.query(`DROP TABLE "brands"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_16aac8a9f6f9c1dd6bcb75ec02"`);
    await queryRunner.query(`DROP TABLE "addresses"`);
  }
}
