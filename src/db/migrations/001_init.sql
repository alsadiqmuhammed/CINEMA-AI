-- Core schema: catalog, carts, orders, CRM, conversations, approvals, audit, alerts.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);

CREATE TABLE categories (
  id    BIGSERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  slug  TEXT NOT NULL UNIQUE,
  sort  INT NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id               BIGSERIAL PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  sku              TEXT UNIQUE,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  faq              JSONB NOT NULL DEFAULT '[]',
  seo_title        TEXT NOT NULL DEFAULT '',
  seo_description  TEXT NOT NULL DEFAULT '',
  tags             TEXT[] NOT NULL DEFAULT '{}',
  category_id      BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  price            NUMERIC(12,3) NOT NULL CHECK (price >= 0),
  compare_at_price NUMERIC(12,3) CHECK (compare_at_price >= 0),
  stock            INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_at     INT NOT NULL DEFAULT 5,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX products_status_idx ON products(status);
-- array_to_string is not IMMUTABLE, so the search text goes through a wrapper the index can use.
CREATE FUNCTION product_search_text(name TEXT, description TEXT, tags TEXT[]) RETURNS TEXT
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT name || ' ' || description || ' ' || array_to_string(tags, ' ') $$;
CREATE INDEX products_search_idx ON products
  USING gin (product_search_text(name, description, tags) gin_trgm_ops);

CREATE TABLE product_images (
  id          BIGSERIAL PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  alt         TEXT NOT NULL DEFAULT '',
  sort        INT NOT NULL DEFAULT 0
);
CREATE INDEX product_images_product_idx ON product_images(product_id);

-- Complementary / alternative products, curated by staff.
CREATE TABLE product_relations (
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  related_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('complement', 'alternative')),
  PRIMARY KEY (product_id, related_id, kind)
);

CREATE TABLE customers (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  source        TEXT NOT NULL DEFAULT 'web',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  interests     TEXT[] NOT NULL DEFAULT '{}',
  notes         TEXT NOT NULL DEFAULT '',
  marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Everything that happens with a customer, for the CRM timeline.
CREATE TABLE customer_events (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  summary      TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_events_customer_idx ON customer_events(customer_id, created_at DESC);

CREATE TABLE carts (
  id             BIGSERIAL PRIMARY KEY,
  token          TEXT NOT NULL UNIQUE,
  customer_id    BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  contact_phone  TEXT,
  contact_email  TEXT,
  source         TEXT NOT NULL DEFAULT 'web',
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted')),
  reminded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX carts_abandoned_idx ON carts(status, updated_at) WHERE status = 'open';

CREATE TABLE cart_items (
  cart_id     BIGINT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    INT NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE orders (
  id               BIGSERIAL PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  customer_id      BIGINT NOT NULL REFERENCES customers(id),
  status           TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('cod', 'bank_transfer', 'online')),
  payment_status   TEXT NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN ('unpaid', 'paid', 'failed', 'refund_pending', 'refunded')),
  subtotal         NUMERIC(12,3) NOT NULL,
  shipping_fee     NUMERIC(12,3) NOT NULL DEFAULT 0,
  total            NUMERIC(12,3) NOT NULL,
  currency         TEXT NOT NULL,
  ship_name        TEXT NOT NULL,
  ship_phone       TEXT NOT NULL,
  ship_city        TEXT NOT NULL,
  ship_address     TEXT NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  tracking_number  TEXT,
  source           TEXT NOT NULL DEFAULT 'web',
  review_requested_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_idx ON orders(customer_id);
CREATE INDEX orders_status_idx ON orders(status, created_at);

CREATE TABLE order_items (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  BIGINT REFERENCES products(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  unit_price  NUMERIC(12,3) NOT NULL,
  quantity    INT NOT NULL CHECK (quantity > 0)
);

CREATE TABLE conversations (
  id            BIGSERIAL PRIMARY KEY,
  channel       TEXT NOT NULL CHECK (channel IN ('web', 'whatsapp', 'messenger', 'instagram')),
  external_id   TEXT NOT NULL,
  customer_id   BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  mode          TEXT NOT NULL DEFAULT 'bot' CHECK (mode IN ('bot', 'human', 'closed')),
  label         TEXT NOT NULL DEFAULT 'new'
                CHECK (label IN ('new', 'interested', 'lead', 'confirmed_order', 'follow_up', 'complaint', 'needs_human')),
  handoff_reason TEXT,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_customer_message_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);
CREATE INDEX conversations_inbox_idx ON conversations(mode, last_message_at DESC);

CREATE TABLE messages (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('customer', 'bot', 'staff', 'system')),
  content          TEXT NOT NULL,
  author_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  external_id      TEXT UNIQUE,  -- channel message id, so webhook retries are not processed twice
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, id);

-- Outbound messages produced by automations. Delivery goes through a channel adapter.
CREATE TABLE outbox (
  id           BIGSERIAL PRIMARY KEY,
  channel      TEXT NOT NULL,
  recipient    TEXT NOT NULL,
  customer_id  BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  purpose      TEXT NOT NULL,
  body         TEXT NOT NULL,
  template     TEXT,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  error        TEXT,
  attempts     INT NOT NULL DEFAULT 0,
  dedupe_key   TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ
);
CREATE INDEX outbox_queue_idx ON outbox(status, created_at) WHERE status = 'queued';

-- Anything the system prepared but a human must approve before it takes effect.
CREATE TABLE approvals (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('product_content', 'ad_campaign', 'broadcast', 'refund')),
  title        TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by TEXT NOT NULL,
  decided_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  decision_note TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX approvals_pending_idx ON approvals(status, created_at);

-- Who did what, when and why. actor_type distinguishes people from automations and the AI.
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('user', 'ai', 'automation', 'customer', 'system')),
  actor_id    TEXT,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  reason      TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log(created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log(entity, entity_id);

CREATE TABLE alerts (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('low_stock', 'order_delayed', 'complaint', 'payment_failed', 'vip_customer', 'integration_error', 'needs_human')),
  severity    TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  message     TEXT NOT NULL,
  link        TEXT,
  dedupe_key  TEXT UNIQUE,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX alerts_open_idx ON alerts(created_at DESC) WHERE resolved_at IS NULL;
