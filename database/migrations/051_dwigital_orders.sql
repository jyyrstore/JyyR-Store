-- Dwigital purchase records are linked to the canonical orders parent.
-- Supplier identifiers remain text and never enter local product UUID FKs.

CREATE TABLE IF NOT EXISTS dwigital_orders (
  order_id uuid PRIMARY KEY
    REFERENCES orders(id) ON DELETE RESTRICT,
  supplier_reference text NOT NULL UNIQUE
    CHECK (
      length(supplier_reference) BETWEEN 1 AND 64
      AND supplier_reference ~ '^[A-Za-z0-9._-]+$'
    ),
  provider_type text NOT NULL
    CHECK (provider_type IN ('digital','game')),
  provider_product_id text NOT NULL
    CHECK (length(btrim(provider_product_id)) BETWEEN 1 AND 128),
  variant_id text NOT NULL
    CHECK (length(btrim(variant_id)) BETWEEN 1 AND 128),
  product_name text NOT NULL
    CHECK (length(btrim(product_name)) BETWEEN 1 AND 300),
  variant_name text NOT NULL
    CHECK (length(btrim(variant_name)) BETWEEN 1 AND 300),
  target_encrypted text NOT NULL,
  retail_price bigint NOT NULL CHECK (retail_price > 0),
  supplier_price bigint NOT NULL CHECK (supplier_price >= 0),
  max_price bigint NOT NULL CHECK (max_price >= 0),
  delivery text NOT NULL
    CHECK (delivery IN ('automatic','manual')),
  supplier_status text NOT NULL DEFAULT 'not_submitted'
    CHECK (
      supplier_status IN (
        'not_submitted','pending','processing','success','partial','failed'
      )
    ),
  supplier_ref_id text,
  supplier_refunded boolean NOT NULL DEFAULT false,
  submission_state text NOT NULL DEFAULT 'not_submitted'
    CHECK (
      submission_state IN (
        'not_submitted','submitting','unknown','submitted'
      )
    ),
  submission_started_at timestamptz,
  submitted_at timestamptz,
  last_polled_at timestamptz,
  supplier_updated_at timestamptz,
  supplier_note_encrypted text,
  supplier_accounts_encrypted text,
  last_error_code text
    CHECK (last_error_code IS NULL OR length(last_error_code) <= 96),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dwigital_orders_supplier_status_idx
  ON dwigital_orders(supplier_status, updated_at);

CREATE INDEX IF NOT EXISTS dwigital_orders_submission_idx
  ON dwigital_orders(submission_state, submission_started_at)
  WHERE supplier_status IN ('not_submitted','pending','processing');

ALTER TABLE dwigital_orders ENABLE ROW LEVEL SECURITY;

-- No raw payload or account data is retained in the deduplication ledger.
CREATE TABLE IF NOT EXISTS dwigital_webhook_events (
  event_key text PRIMARY KEY
    CHECK (length(event_key) = 64),
  supplier_reference text NOT NULL,
  event_name text NOT NULL
    CHECK (length(event_name) BETWEEN 1 AND 64),
  supplier_status text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS dwigital_webhook_events_reference_idx
  ON dwigital_webhook_events(supplier_reference, received_at DESC);

ALTER TABLE dwigital_webhook_events ENABLE ROW LEVEL SECURITY;
