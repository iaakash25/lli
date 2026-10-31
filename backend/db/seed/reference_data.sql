-- Reference data needed in every environment: permissions, roles and role→permission mapping.
-- Idempotent (safe to re-run). Contains no users, no passwords and no secrets: the first Super Admin
-- is created once by a CLI prompt in a later phase, never by a default credential.
--
-- Tax rates are inserted INACTIVE as placeholders. GST rates and HSN codes need chartered-accountant
-- sign-off (roadmap D14) before any is activated.

INSERT INTO permissions (key, description) VALUES
  ('products.read',      'View products, variants and costs'),
  ('products.create',    'Create products and variants'),
  ('products.update',    'Edit products, variants and prices'),
  ('products.delete',    'Archive or delete products'),
  ('products.publish',   'Publish or unpublish products'),
  ('categories.manage',  'Manage categories'),
  ('collections.manage', 'Manage collections'),
  ('media.upload',       'Upload and manage media'),
  ('inventory.read',     'View stock levels and movements'),
  ('inventory.adjust',   'Adjust stock'),
  ('orders.read',        'View orders'),
  ('orders.update',      'Move orders through fulfilment states'),
  ('orders.cancel',      'Cancel orders'),
  ('returns.manage',     'Review and decide return requests'),
  ('refunds.request',    'Request a refund'),
  ('refunds.approve',    'Approve and issue refunds'),
  ('customers.read',     'View customer profiles (masked contact data)'),
  ('customers.pii.read', 'View full customer contact data'),
  ('coupons.manage',     'Manage coupons and promotions'),
  ('reviews.moderate',   'Moderate customer reviews'),
  ('cms.manage',         'Manage pages and banners'),
  ('shipping.manage',    'Manage shipping rates and shipments'),
  ('settings.manage',    'Change site, tax and payment settings'),
  ('users.manage',       'Manage staff accounts'),
  ('roles.manage',       'Create roles and assign permissions'),
  ('audit.read',         'View the admin audit log'),
  ('reports.read',       'View sales and operations reports'),
  ('ai.manage',          'Configure the AI assistant')
ON CONFLICT (key) DO NOTHING;

INSERT INTO roles (name, description, is_system) VALUES
  ('Super Admin',       'Full access including role management',            true),
  ('Admin',             'Full operational access except role management',   true),
  ('Catalogue Manager', 'Products, categories, collections, media, stock',  true),
  ('Order Manager',     'Orders, returns, shipping and customer lookup',    true),
  ('Finance',           'Refund approval, reports and audit visibility',    true),
  ('Support Agent',     'Order and customer lookup, refund requests',       true),
  ('Content Editor',    'Pages, banners and review moderation',             true)
ON CONFLICT (name) DO NOTHING;

-- Super Admin: every permission. Admin: every permission except roles.manage.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE (r.name = 'Super Admin')
    OR (r.name = 'Admin' AND p.key <> 'roles.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM (VALUES
    ('Catalogue Manager', 'products.read'),   ('Catalogue Manager', 'products.create'),
    ('Catalogue Manager', 'products.update'), ('Catalogue Manager', 'products.publish'),
    ('Catalogue Manager', 'categories.manage'), ('Catalogue Manager', 'collections.manage'),
    ('Catalogue Manager', 'media.upload'),    ('Catalogue Manager', 'inventory.read'),
    ('Catalogue Manager', 'inventory.adjust'),
    ('Order Manager', 'orders.read'),         ('Order Manager', 'orders.update'),
    ('Order Manager', 'orders.cancel'),       ('Order Manager', 'returns.manage'),
    ('Order Manager', 'shipping.manage'),     ('Order Manager', 'customers.read'),
    ('Order Manager', 'inventory.read'),
    ('Finance', 'orders.read'),               ('Finance', 'refunds.approve'),
    ('Finance', 'refunds.request'),           ('Finance', 'reports.read'),
    ('Finance', 'audit.read'),
    ('Support Agent', 'orders.read'),         ('Support Agent', 'customers.read'),
    ('Support Agent', 'refunds.request'),     ('Support Agent', 'returns.manage'),
    ('Content Editor', 'cms.manage'),         ('Content Editor', 'reviews.moderate'),
    ('Content Editor', 'media.upload')
  ) AS m (role_name, permission_key)
  JOIN roles r ON r.name = m.role_name
  JOIN permissions p ON p.key = m.permission_key
ON CONFLICT DO NOTHING;

-- Placeholder GST rates, inactive until approved.
INSERT INTO tax_rates (name, rate_basis_points, is_active) VALUES
  ('GST 5% (placeholder, pending CA sign-off)',  500,  false),
  ('GST 12% (placeholder, pending CA sign-off)', 1200, false),
  ('GST 18% (placeholder, pending CA sign-off)', 1800, false)
ON CONFLICT (name) DO NOTHING;
