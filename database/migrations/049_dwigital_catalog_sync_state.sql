-- Persistent scheduler state for the Dwigital catalog sync
-- Backend-only table. RLS is enabled without client-facing policies.

CREATE TABLE IF NOT EXISTS dwigital_catalog_sync_state (
  id smallint PRIMARY KEY DEFAULT 1
    CHECK (id = 1),
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error_code text
    CHECK (last_error_code IS NULL OR length(last_error_code) <= 64),
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

ALTER TABLE dwigital_catalog_sync_state ENABLE ROW LEVEL SECURITY;
