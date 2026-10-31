-- 0002_constraints: what Prisma cannot express — extensions, CHECK constraints, partial unique
-- indexes, generated search column, append-only triggers, order-state-machine guard.
--
-- Scope: this file only touches objects inside the LLI database's public schema.
-- (pg_trgm is a trusted extension on PostgreSQL 13+, so the database owner can create it.)
--
-- IMPORTANT: apply with `prisma migrate deploy` only. Do not run `prisma migrate dev` or
-- `prisma db push` against this database: they diff against the Prisma schema, which cannot
-- see the objects below, and `migrate dev` needs a shadow database (CREATE DATABASE).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Prisma's @updatedAt is filled in by the client, leaving the column without a database default.
-- Give every updated_at a default so raw SQL (seeds, admin scripts, tests) cannot insert NULL.
DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'updated_at' AND column_default IS NULL
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN updated_at SET DEFAULT now()', col.table_name);
  END LOOP;
END;
$$;

-- ───────────────────────── Integrity: CHECK constraints ─────────────────────────

ALTER TABLE users
  ADD CONSTRAINT users_email_normalized_chk CHECK (email_normalized = lower(btrim(email_normalized))),
  ADD CONSTRAINT users_failed_login_chk CHECK (failed_login_count >= 0);

ALTER TABLE addresses
  ADD CONSTRAINT addresses_postal_code_chk CHECK (country <> 'IN' OR postal_code ~ '^[1-9][0-9]{5}$');

ALTER TABLE product_variants
  ADD CONSTRAINT variants_price_chk CHECK (price_paise >= 0),
  ADD CONSTRAINT variants_compare_at_chk CHECK (compare_at_paise IS NULL OR compare_at_paise >= price_paise),
  ADD CONSTRAINT variants_cost_chk CHECK (cost_paise IS NULL OR cost_paise >= 0),
  ADD CONSTRAINT variants_weight_chk CHECK (weight_grams IS NULL OR weight_grams > 0),
  ADD CONSTRAINT variants_swatch_chk CHECK (colour_swatch IS NULL OR colour_swatch ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE media_assets
  ADD CONSTRAINT media_size_chk CHECK (size_bytes > 0);

-- Stock can never go negative and reservations can never exceed what is on hand.
ALTER TABLE inventory
  ADD CONSTRAINT inventory_stock_chk CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand),
  ADD CONSTRAINT inventory_threshold_chk CHECK (low_stock_threshold >= 0);

ALTER TABLE inventory_reservations
  ADD CONSTRAINT reservations_quantity_chk CHECK (quantity > 0);

ALTER TABLE inventory_movements
  ADD CONSTRAINT movements_delta_chk CHECK (delta <> 0);

ALTER TABLE carts
  ADD CONSTRAINT carts_owner_chk CHECK (user_id IS NOT NULL OR guest_token_hash IS NOT NULL);

ALTER TABLE cart_items
  ADD CONSTRAINT cart_items_quantity_chk CHECK (quantity BETWEEN 1 AND 50);

ALTER TABLE tax_rates
  ADD CONSTRAINT tax_rates_basis_points_chk CHECK (rate_basis_points BETWEEN 0 AND 10000);

ALTER TABLE coupons
  ADD CONSTRAINT coupons_code_upper_chk CHECK (code = upper(btrim(code)) AND length(code) BETWEEN 3 AND 40),
  ADD CONSTRAINT coupons_value_chk CHECK (
    discount_value > 0 AND (discount_type <> 'PERCENT' OR discount_value <= 10000)
  ),
  ADD CONSTRAINT coupons_max_discount_chk CHECK (max_discount_paise IS NULL OR max_discount_paise > 0),
  ADD CONSTRAINT coupons_min_subtotal_chk CHECK (min_subtotal_paise >= 0),
  ADD CONSTRAINT coupons_limits_chk CHECK (
    (usage_limit IS NULL OR usage_limit > 0) AND (per_user_limit IS NULL OR per_user_limit > 0) AND used_count >= 0
  ),
  ADD CONSTRAINT coupons_window_chk CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);

ALTER TABLE coupon_redemptions
  ADD CONSTRAINT redemptions_amount_chk CHECK (amount_paise >= 0);

-- Money amounts are non-negative. total_paise is deliberately NOT tied to a formula yet: whether
-- prices are GST-inclusive is an open decision (roadmap D14); add the formula once it is made.
ALTER TABLE orders
  ADD CONSTRAINT orders_amounts_chk CHECK (
    subtotal_paise >= 0 AND discount_paise >= 0 AND shipping_paise >= 0 AND tax_paise >= 0
    AND total_paise >= 0 AND discount_paise <= subtotal_paise
  ),
  ADD CONSTRAINT orders_currency_chk CHECK (currency = 'INR'),
  ADD CONSTRAINT orders_owner_chk CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL);

ALTER TABLE order_items
  ADD CONSTRAINT order_items_quantity_chk CHECK (quantity > 0),
  ADD CONSTRAINT order_items_amounts_chk CHECK (
    unit_price_paise >= 0 AND discount_paise >= 0 AND tax_paise >= 0 AND total_paise >= 0
    AND tax_rate_basis_points BETWEEN 0 AND 10000
  );

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_chk CHECK (amount_paise > 0),
  ADD CONSTRAINT payments_currency_chk CHECK (currency = 'INR');

ALTER TABLE refunds
  ADD CONSTRAINT refunds_amount_chk CHECK (amount_paise > 0);

ALTER TABLE shipping_rates
  ADD CONSTRAINT shipping_rates_chk CHECK (
    rate_paise >= 0 AND min_subtotal_paise >= 0
    AND (max_subtotal_paise IS NULL OR max_subtotal_paise > min_subtotal_paise)
    AND (estimated_days_min IS NULL OR estimated_days_max IS NULL OR estimated_days_max >= estimated_days_min)
  );

ALTER TABLE return_items
  ADD CONSTRAINT return_items_quantity_chk CHECK (quantity > 0);

ALTER TABLE reviews
  ADD CONSTRAINT reviews_rating_chk CHECK (rating BETWEEN 1 AND 5);

ALTER TABLE ai_conversations
  ADD CONSTRAINT ai_conversations_owner_chk CHECK (user_id IS NOT NULL OR session_ref IS NOT NULL);

-- ───────────────────── Partial unique indexes (rules that ignore soft-deleted rows) ─────────────────────

-- At most one default address per user.
CREATE UNIQUE INDEX addresses_one_default_per_user ON addresses (user_id)
  WHERE is_default AND deleted_at IS NULL;

-- At most one active cart per signed-in user.
CREATE UNIQUE INDEX carts_one_active_per_user ON carts (user_id)
  WHERE status = 'ACTIVE' AND user_id IS NOT NULL;

-- At most one captured payment per order (guards against double-capture bugs).
CREATE UNIQUE INDEX payments_one_captured_per_order ON payments (order_id)
  WHERE status = 'CAPTURED';

-- At most one verified credential of each type per user.
CREATE UNIQUE INDEX mfa_one_verified_per_type ON mfa_credentials (user_id, type)
  WHERE verified_at IS NOT NULL;

-- Hot-path partial indexes.
CREATE INDEX reservations_active_expiry_idx ON inventory_reservations (expires_at) WHERE status = 'ACTIVE';
CREATE INDEX products_active_rank_idx ON products (rank DESC) WHERE status = 'ACTIVE' AND deleted_at IS NULL;

-- ───────────────────────────── Search ─────────────────────────────

ALTER TABLE products
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' || coalesce(tagline, '') || ' ' || coalesce(product_type, '') || ' '
        || coalesce(material, '')
    )
  ) STORED;

CREATE INDEX products_search_vector_idx ON products USING gin (search_vector);
CREATE INDEX products_name_trgm_idx ON products USING gin (name gin_trgm_ops);
CREATE INDEX variants_sku_trgm_idx ON product_variants USING gin (sku gin_trgm_ops);

-- ─────────────────────────── Append-only tables ───────────────────────────
-- UPDATE, DELETE and TRUNCATE are rejected by trigger even for the table owner, so a bug or a
-- compromised application account cannot rewrite history. (Rows are removed only by dropping the
-- table or database, e.g. in tests; retention purges, if ever needed, are a reviewed migration.)

CREATE FUNCTION lli_reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER admin_audit_logs_append_only BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION lli_reject_modification();
CREATE TRIGGER admin_audit_logs_no_truncate BEFORE TRUNCATE ON admin_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION lli_reject_modification();

CREATE TRIGGER security_events_append_only BEFORE UPDATE OR DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION lli_reject_modification();
CREATE TRIGGER security_events_no_truncate BEFORE TRUNCATE ON security_events
  FOR EACH STATEMENT EXECUTE FUNCTION lli_reject_modification();

CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION lli_reject_modification();
CREATE TRIGGER inventory_movements_no_truncate BEFORE TRUNCATE ON inventory_movements
  FOR EACH STATEMENT EXECUTE FUNCTION lli_reject_modification();

CREATE TRIGGER order_status_history_append_only BEFORE UPDATE OR DELETE ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION lli_reject_modification();
CREATE TRIGGER order_status_history_no_truncate BEFORE TRUNCATE ON order_status_history
  FOR EACH STATEMENT EXECUTE FUNCTION lli_reject_modification();

-- ───────────────────────── Order state machine guard ─────────────────────────
-- Defence in depth: the service layer owns transitions (transition(order, to, actor, reason));
-- this trigger refuses any status change that is not an edge in docs/SYSTEM_ARCHITECTURE.md §6.2.

CREATE FUNCTION lli_check_order_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('PENDING_PAYMENT', 'PAYMENT_FAILED'),
    ('PENDING_PAYMENT', 'CONFIRMED'),
    ('PENDING_PAYMENT', 'CANCELLED'),
    ('PAYMENT_FAILED', 'PENDING_PAYMENT'),
    ('PAYMENT_FAILED', 'CANCELLED'),
    ('CONFIRMED', 'PROCESSING'),
    ('CONFIRMED', 'CANCELLATION_REQUESTED'),
    ('PROCESSING', 'PACKED'),
    ('PROCESSING', 'CANCELLATION_REQUESTED'),
    ('PACKED', 'SHIPPED'),
    ('SHIPPED', 'OUT_FOR_DELIVERY'),
    ('OUT_FOR_DELIVERY', 'DELIVERED'),
    ('CANCELLATION_REQUESTED', 'CANCELLED'),
    ('CANCELLATION_REQUESTED', 'PROCESSING'),
    ('DELIVERED', 'RETURN_REQUESTED'),
    ('RETURN_REQUESTED', 'RETURNED'),
    ('RETURNED', 'REFUNDED'),
    ('RETURNED', 'PARTIALLY_REFUNDED'),
    ('PARTIALLY_REFUNDED', 'REFUNDED'),
    ('CANCELLED', 'REFUNDED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'illegal order status transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER orders_status_transition BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION lli_check_order_transition();
