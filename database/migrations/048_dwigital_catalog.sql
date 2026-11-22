-- Dwigital supplier catalog snapshot.
-- Server-side access only. No public or authenticated client policies.

CREATE TABLE IF NOT EXISTS dwigital_catalog (
  variant_id text PRIMARY KEY
    CHECK (length(btrim(variant_id)) BETWEEN 1 AND 128),
  type text NOT NULL
    CHECK (type IN ('game','sosmed','ppob','digital')),
  payload jsonb NOT NULL
    CHECK (jsonb_typeof(payload) = 'object'),
  is_active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dwigital_catalog_active_type_idx
  ON dwigital_catalog(type, synced_at DESC)
  WHERE is_active = true;

ALTER TABLE dwigital_catalog ENABLE ROW LEVEL SECURITY;
