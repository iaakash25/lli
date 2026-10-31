-- Rolls back migrations 0001_init and 0002_constraints: drops every object they created.
--
-- DESTRUCTIVE. Intended for the first deployment, before the application holds real data, or for
-- rehearsals on a copy. After go-live, roll back by restoring the backup taken before the migration.
--
-- Refuses to run unless connected to the LLI database, and refuses to run if any business table
-- holds rows (set lli.allow_data_loss = on in the session to override, after a verified backup).
-- Leaves the pg_trgm extension and _prisma_migrations bookkeeping alone.

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  IF current_database() <> 'LLI' THEN
    RAISE EXCEPTION 'refusing to run: connected to database %, expected LLI', current_database();
  END IF;
  IF coalesce(current_setting('lli.allow_data_loss', true), 'off') <> 'on' THEN
    FOREACH t IN ARRAY ARRAY['users', 'products', 'orders', 'payments', 'admin_audit_logs', 'inventory_movements'] LOOP
      IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
        EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
        IF n > 0 THEN
          RAISE EXCEPTION 'refusing to roll back: table % holds % rows (set lli.allow_data_loss = on to override)', t, n;
        END IF;
      END IF;
    END LOOP;
  END IF;
END;
$$;

DROP TABLE IF EXISTS "addresses" CASCADE;
DROP TABLE IF EXISTS "admin_audit_logs" CASCADE;
DROP TABLE IF EXISTS "ai_conversations" CASCADE;
DROP TABLE IF EXISTS "ai_messages" CASCADE;
DROP TABLE IF EXISTS "banners" CASCADE;
DROP TABLE IF EXISTS "cart_items" CASCADE;
DROP TABLE IF EXISTS "carts" CASCADE;
DROP TABLE IF EXISTS "categories" CASCADE;
DROP TABLE IF EXISTS "cms_pages" CASCADE;
DROP TABLE IF EXISTS "collection_products" CASCADE;
DROP TABLE IF EXISTS "collections" CASCADE;
DROP TABLE IF EXISTS "consents" CASCADE;
DROP TABLE IF EXISTS "coupon_redemptions" CASCADE;
DROP TABLE IF EXISTS "coupons" CASCADE;
DROP TABLE IF EXISTS "idempotency_keys" CASCADE;
DROP TABLE IF EXISTS "inventory" CASCADE;
DROP TABLE IF EXISTS "inventory_movements" CASCADE;
DROP TABLE IF EXISTS "inventory_reservations" CASCADE;
DROP TABLE IF EXISTS "media_assets" CASCADE;
DROP TABLE IF EXISTS "mfa_credentials" CASCADE;
DROP TABLE IF EXISTS "notification_logs" CASCADE;
DROP TABLE IF EXISTS "one_time_tokens" CASCADE;
DROP TABLE IF EXISTS "order_items" CASCADE;
DROP TABLE IF EXISTS "order_status_history" CASCADE;
DROP TABLE IF EXISTS "orders" CASCADE;
DROP TABLE IF EXISTS "payment_webhook_events" CASCADE;
DROP TABLE IF EXISTS "payments" CASCADE;
DROP TABLE IF EXISTS "permissions" CASCADE;
DROP TABLE IF EXISTS "product_categories" CASCADE;
DROP TABLE IF EXISTS "product_images" CASCADE;
DROP TABLE IF EXISTS "product_variants" CASCADE;
DROP TABLE IF EXISTS "products" CASCADE;
DROP TABLE IF EXISTS "refunds" CASCADE;
DROP TABLE IF EXISTS "return_items" CASCADE;
DROP TABLE IF EXISTS "return_requests" CASCADE;
DROP TABLE IF EXISTS "reviews" CASCADE;
DROP TABLE IF EXISTS "role_permissions" CASCADE;
DROP TABLE IF EXISTS "roles" CASCADE;
DROP TABLE IF EXISTS "security_events" CASCADE;
DROP TABLE IF EXISTS "sessions" CASCADE;
DROP TABLE IF EXISTS "shipment_events" CASCADE;
DROP TABLE IF EXISTS "shipments" CASCADE;
DROP TABLE IF EXISTS "shipping_rates" CASCADE;
DROP TABLE IF EXISTS "site_settings" CASCADE;
DROP TABLE IF EXISTS "tax_rates" CASCADE;
DROP TABLE IF EXISTS "user_roles" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "wishlist_items" CASCADE;
DROP TABLE IF EXISTS "wishlists" CASCADE;

DROP TYPE IF EXISTS "ai_role";
DROP TYPE IF EXISTS "cart_status";
DROP TYPE IF EXISTS "collection_kind";
DROP TYPE IF EXISTS "discount_type";
DROP TYPE IF EXISTS "gender";
DROP TYPE IF EXISTS "job_status";
DROP TYPE IF EXISTS "media_status";
DROP TYPE IF EXISTS "movement_reason";
DROP TYPE IF EXISTS "order_status";
DROP TYPE IF EXISTS "payment_method";
DROP TYPE IF EXISTS "payment_status";
DROP TYPE IF EXISTS "product_status";
DROP TYPE IF EXISTS "publish_status";
DROP TYPE IF EXISTS "refund_status";
DROP TYPE IF EXISTS "reservation_status";
DROP TYPE IF EXISTS "return_status";
DROP TYPE IF EXISTS "review_status";
DROP TYPE IF EXISTS "shipment_status";
DROP TYPE IF EXISTS "token_purpose";
DROP TYPE IF EXISTS "user_status";

DROP FUNCTION IF EXISTS lli_reject_modification();
DROP FUNCTION IF EXISTS lli_check_order_transition();
