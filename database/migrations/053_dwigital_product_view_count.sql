-- Store public Dwigital product view metrics.
-- Backend-owned metric; no client-facing write policy is added.

ALTER TABLE public.dwigital_display_products
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0
  CHECK (view_count >= 0);
