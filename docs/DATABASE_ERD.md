# Database ERD

Entity-relationship overview of the LLI database (PostgreSQL, `public` schema). Column-level detail is in [DATABASE_DICTIONARY.md](DATABASE_DICTIONARY.md), which is generated from the migrations. Source of truth: `backend/prisma/schema.prisma` plus `backend/prisma/migrations/0002_constraints`.

Design rules that apply everywhere: UUID keys, integer paise, `timestamptz`, foreign keys on every relation, soft deletes (`deleted_at`) only where history matters, and snapshots on orders so editing a product never changes a past order.

## Identity and access

```mermaid
erDiagram
  USERS ||--o{ SESSIONS : "refresh tokens (hash only)"
  USERS ||--o{ ONE_TIME_TOKENS : "verify / reset / guest access"
  USERS ||--o{ MFA_CREDENTIALS : has
  USERS ||--o{ ADDRESSES : has
  USERS ||--o{ CONSENTS : "DPDP consent records"
  USERS ||--o{ SECURITY_EVENTS : "append-only"
  USERS ||--o{ USER_ROLES : has
  ROLES ||--o{ USER_ROLES : grants
  ROLES ||--o{ ROLE_PERMISSIONS : includes
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : "in"
```

## Catalogue and inventory

```mermaid
erDiagram
  CATEGORIES ||--o{ CATEGORIES : "parent"
  PRODUCTS ||--|{ PRODUCT_VARIANTS : "sellable SKUs"
  PRODUCTS ||--o{ PRODUCT_CATEGORIES : in
  CATEGORIES ||--o{ PRODUCT_CATEGORIES : contains
  PRODUCTS ||--o{ COLLECTION_PRODUCTS : in
  COLLECTIONS ||--o{ COLLECTION_PRODUCTS : contains
  PRODUCTS ||--o{ PRODUCT_IMAGES : shows
  MEDIA_ASSETS ||--o{ PRODUCT_IMAGES : used_by
  TAX_RATES ||--o{ PRODUCTS : applies_to
  PRODUCT_VARIANTS ||--|| INVENTORY : "on_hand / reserved"
  PRODUCT_VARIANTS ||--o{ INVENTORY_RESERVATIONS : held_by
  PRODUCT_VARIANTS ||--o{ INVENTORY_MOVEMENTS : "append-only ledger"
```

## Cart, wishlist and orders

```mermaid
erDiagram
  USERS ||--o{ CARTS : owns
  CARTS ||--o{ CART_ITEMS : has
  PRODUCT_VARIANTS ||--o{ CART_ITEMS : in
  USERS ||--o| WISHLISTS : has
  WISHLISTS ||--o{ WISHLIST_ITEMS : has
  PRODUCTS ||--o{ WISHLIST_ITEMS : in
  USERS ||--o{ ORDERS : places
  ORDERS ||--|{ ORDER_ITEMS : "snapshot of what was sold"
  ORDERS ||--o{ ORDER_STATUS_HISTORY : "append-only"
  ORDERS ||--o{ INVENTORY_RESERVATIONS : reserves
  ORDERS ||--o{ PAYMENTS : paid_by
  PAYMENTS ||--o{ REFUNDS : refunded_by
  COUPONS ||--o{ COUPON_REDEMPTIONS : used_in
  ORDERS ||--o| COUPON_REDEMPTIONS : uses
  ORDERS ||--o{ SHIPMENTS : fulfilled_by
  SHIPMENTS ||--o{ SHIPMENT_EVENTS : tracks
  ORDERS ||--o{ RETURN_REQUESTS : "may have"
  RETURN_REQUESTS ||--|{ RETURN_ITEMS : covers
  ORDER_ITEMS ||--o{ RETURN_ITEMS : returned_as
  RETURN_REQUESTS ||--o{ REFUNDS : leads_to
```

`payment_webhook_events` stands alone (keyed by the gateway's unique event id) so duplicate deliveries are rejected before any order is touched.

## Content, audit and AI

```mermaid
erDiagram
  USERS ||--o{ REVIEWS : writes
  PRODUCTS ||--o{ REVIEWS : receives
  MEDIA_ASSETS ||--o{ BANNERS : used_by
  MEDIA_ASSETS ||--o{ COLLECTIONS : hero_image
  USERS ||--o{ ADMIN_AUDIT_LOGS : "actor (append-only)"
  USERS ||--o{ AI_CONVERSATIONS : has
  AI_CONVERSATIONS ||--o{ AI_MESSAGES : contains
```

Standalone tables: `cms_pages`, `site_settings`, `shipping_rates`, `idempotency_keys`, `notification_logs`, `payment_webhook_events`.

## Guarantees enforced by the database (not just the application)

| Guarantee | Mechanism |
|---|---|
| Stock never negative; `reserved <= on_hand` | `CHECK inventory_stock_chk` |
| Reservation is atomic | single `UPDATE … WHERE on_hand - reserved >= qty`; tested |
| One email per user, case-insensitive | unique `email_normalized` + check it is lower-case and trimmed |
| One default address, one active cart per user | partial unique indexes |
| One captured payment per order | partial unique index |
| Gateway events/payments processed once | unique `provider_event_id`, `provider_payment_id`, `provider_order_id` |
| Audit, security, stock-ledger and status-history rows cannot be changed | triggers reject `UPDATE`/`DELETE`/`TRUNCATE`; app role also lacks the privileges |
| Orders only move along legal edges | trigger `orders_status_transition` (mirrors SYSTEM_ARCHITECTURE §6.2) |
| Money is non-negative integers; currency is INR | `CHECK`s on orders, items, payments, refunds, coupons, variants |
| Ratings 1–5; one review per user per product | `CHECK` + unique |

## Known limits and open questions

- **GST:** whether listed prices include GST is undecided (roadmap D14), so `orders.total_paise` is not yet tied to a formula. Tax rates are seeded inactive.
- **Rejected returns:** the state machine has no edge from `RETURN_REQUESTED` back to `DELIVERED`, so a rejected return cannot restore the order status. Needs a product decision before Phase 5. `PARTIALLY_REFUNDED → REFUNDED` was added beyond the original diagram.
- **User deletion:** users are never hard-deleted. Erasure (DPDP) is anonymisation by the service, because the append-only triggers also block the foreign-key `SET NULL` that a hard delete would cause.
- **Search:** `products.search_vector` (generated `tsvector`) and `pg_trgm` indexes cover name, tagline, type, material and SKU. Variant attributes are not searchable yet.
- **Prisma drift:** the generated column, triggers and CHECKs are invisible to Prisma. Use `prisma migrate deploy` only; never `migrate dev` or `db push`.
