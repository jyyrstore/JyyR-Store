-- Independent display configuration for the Dwigital storefront.
-- Provider data remains canonical in dwigital_catalog.
-- Backend-only access: RLS enabled without client-facing policies.

CREATE TABLE IF NOT EXISTS dwigital_display_categories (
  category_key text PRIMARY KEY
    CHECK (length(btrim(category_key)) BETWEEN 1 AND 80),
  name text NOT NULL
    CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  parent_key text
    REFERENCES dwigital_display_categories(category_key)
    ON DELETE RESTRICT,
  icon_key text,
  sort_order integer NOT NULL DEFAULT 0
    CHECK (sort_order BETWEEN 0 AND 100000),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_key IS NULL OR parent_key <> category_key)
);

CREATE TABLE IF NOT EXISTS dwigital_display_products (
  provider_type text NOT NULL
    CHECK (provider_type IN ('digital','game')),
  provider_product_id text NOT NULL
    CHECK (length(btrim(provider_product_id)) BETWEEN 1 AND 128),
  category_key text NOT NULL
    REFERENCES dwigital_display_categories(category_key)
    ON DELETE RESTRICT,
  display_name text NOT NULL
    CHECK (length(btrim(display_name)) BETWEEN 2 AND 160),
  sort_order integer NOT NULL DEFAULT 0
    CHECK (sort_order BETWEEN 0 AND 100000),
  is_visible boolean NOT NULL DEFAULT false,
  cover_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_type, provider_product_id)
);

CREATE TABLE IF NOT EXISTS dwigital_display_variants (
  variant_id text PRIMARY KEY
    REFERENCES dwigital_catalog(variant_id)
    ON DELETE CASCADE,
  provider_type text NOT NULL,
  provider_product_id text NOT NULL,
  display_name text
    CHECK (
      display_name IS NULL
      OR length(btrim(display_name)) BETWEEN 1 AND 160
    ),
  retail_price bigint
    CHECK (retail_price IS NULL OR retail_price >= 0),
  sort_order integer NOT NULL DEFAULT 0
    CHECK (sort_order BETWEEN 0 AND 100000),
  is_visible boolean NOT NULL DEFAULT false,
  icon_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (provider_type, provider_product_id)
    REFERENCES dwigital_display_products(provider_type, provider_product_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS dwigital_display_products_category_idx
  ON dwigital_display_products(category_key, sort_order);

CREATE INDEX IF NOT EXISTS dwigital_display_products_visible_idx
  ON dwigital_display_products(provider_type, sort_order)
  WHERE is_visible = true;

CREATE INDEX IF NOT EXISTS dwigital_display_variants_product_idx
  ON dwigital_display_variants(
    provider_type,
    provider_product_id,
    sort_order
  );

ALTER TABLE dwigital_display_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE dwigital_display_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE dwigital_display_variants ENABLE ROW LEVEL SECURITY;

INSERT INTO dwigital_display_categories
  (category_key, name, parent_key, icon_key, sort_order)
VALUES
  ('premium', 'Aplikasi Premium', NULL, 'premium-app', 10),
  ('premium-editing', 'Editing', 'premium', 'editing-design', 10),
  ('premium-streaming-music', 'Streaming & Music', 'premium', 'premium-app', 20),
  ('premium-ai-productivity', 'AI & Productivity', 'premium', 'premium-app', 30),
  ('game', 'Game', NULL, 'console-game', 20),
  ('game-top-up', 'Top up', 'game', 'console-game', 10)
ON CONFLICT (category_key) DO UPDATE
SET
  name = EXCLUDED.name,
  parent_key = EXCLUDED.parent_key,
  icon_key = EXCLUDED.icon_key,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

WITH product_map (
  provider_type,
  provider_product_id,
  display_name,
  category_key,
  sort_order
) AS (
  VALUES
    ('digital','9','Alight Motion','premium-editing',10),
    ('digital','7','Canva Premium','premium-editing',20),
    ('digital','3','CapCut Pro','premium-editing',30),
    ('digital','21','Meitu','premium-editing',40),
    ('digital','901','Wink','premium-editing',50),
    ('digital','1134','Figma','premium-editing',60),
    ('digital','1257','PicsArt','premium-editing',70),

    ('digital','903','Apple Music','premium-streaming-music',10),
    ('digital','12','Spotify','premium-streaming-music',20),
    ('digital','1','Netflix','premium-streaming-music',30),
    ('digital','5','YouTube','premium-streaming-music',40),
    ('digital','17','Disney','premium-streaming-music',50),
    ('digital','15','Bstation','premium-streaming-music',60),
    ('digital','908','Crunchyroll','premium-streaming-music',70),
    ('digital','897','Viu','premium-streaming-music',80),
    ('digital','4','Vidio','premium-streaming-music',90),
    ('digital','900','WeTV','premium-streaming-music',100),
    ('digital','10','Amazon Prime','premium-streaming-music',110),
    ('digital','19','HBO','premium-streaming-music',120),
    ('digital','20','LokLok','premium-streaming-music',130),
    ('digital','902','Youku','premium-streaming-music',140),

    ('digital','8','ChatGPT','premium-ai-productivity',10),
    ('digital','1382','Codex','premium-ai-productivity',20),
    ('digital','16','Claude','premium-ai-productivity',30),
    ('digital','2','Gemini Pro','premium-ai-productivity',40),
    ('digital','6','Grok','premium-ai-productivity',50),

    ('game','817','Mobile Legend (ID)','game-top-up',10),
    ('game','802','Magic Chess: Go Go','game-top-up',20),
    ('game','770','Free Fire','game-top-up',30),
    ('game','772','Free Fire Max','game-top-up',40),
    ('game','841','PUBG Mobile ID','game-top-up',50),
    ('game','788','Honor of Kings Global','game-top-up',60),
    ('game','877','Voucher Roblox','game-top-up',70)
),
available_products AS (
  SELECT
    mapping.provider_type,
    mapping.provider_product_id,
    mapping.display_name,
    mapping.category_key,
    mapping.sort_order
  FROM product_map mapping
  WHERE EXISTS (
    SELECT 1
    FROM dwigital_catalog source
    WHERE source.is_active = true
      AND source.type = mapping.provider_type
      AND source.payload->>'product_id' = mapping.provider_product_id
  )
)
INSERT INTO dwigital_display_products (
  provider_type,
  provider_product_id,
  category_key,
  display_name,
  sort_order,
  is_visible
)
SELECT
  provider_type,
  provider_product_id,
  category_key,
  display_name,
  sort_order,
  false
FROM available_products
ON CONFLICT (provider_type, provider_product_id) DO NOTHING;

INSERT INTO dwigital_display_variants (
  provider_type,
  provider_product_id,
  variant_id,
  display_name,
  sort_order,
  is_visible
)
SELECT
  product.provider_type,
  product.provider_product_id,
  source.variant_id,
  NULLIF(source.payload->>'name', ''),
  row_number() OVER (
    PARTITION BY product.provider_type, product.provider_product_id
    ORDER BY source.variant_id
  )::integer - 1,
  false
FROM dwigital_display_products product
JOIN dwigital_catalog source
  ON source.type = product.provider_type
 AND source.payload->>'product_id' = product.provider_product_id
 AND source.is_active = true
ON CONFLICT (variant_id) DO NOTHING;
