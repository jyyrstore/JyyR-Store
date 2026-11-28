ALTER TABLE public.product_reviews
  ALTER COLUMN product_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS provider_type text,
  ADD COLUMN IF NOT EXISTS provider_product_id text;

ALTER TABLE public.product_reviews
  DROP CONSTRAINT IF EXISTS product_reviews_target_check;

ALTER TABLE public.product_reviews
  ADD CONSTRAINT product_reviews_target_check
  CHECK (
    (
      product_id IS NOT NULL
      AND provider_type IS NULL
      AND provider_product_id IS NULL
    )
    OR
    (
      product_id IS NULL
      AND provider_type IN ('digital','game')
      AND provider_product_id IS NOT NULL
      AND length(btrim(provider_product_id)) BETWEEN 1 AND 128
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_reviews_dwigital_user
  ON public.product_reviews(provider_type,provider_product_id,user_id)
  WHERE product_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_reviews_dwigital_created
  ON public.product_reviews(provider_type,provider_product_id,created_at DESC)
  WHERE product_id IS NULL;
