const {query,withTransaction}=require('../config/database');

const CATEGORY_KEYS=Object.freeze({
  digital:new Set([
    'premium-editing',
    'premium-streaming-music',
    'premium-ai-productivity'
  ]),
  game:new Set(['game-top-up'])
});

const ROOT_BY_TYPE=Object.freeze({
  digital:'premium',
  game:'game'
});

function displayError(code,message,status=400){
  const error=new Error(message);
  error.code=code;
  error.status=status;
  error.expose=true;
  return error;
}

function cleanText(value,name,{minimum=0,maximum=160,nullable=false}={}){
  if(value===null||value===undefined||value===''){
    if(nullable)return null;
    throw displayError('INVALID_DWIGITAL_DISPLAY_CONFIG',`${name} wajib diisi.`);
  }

  if(typeof value!=='string'){
    throw displayError('INVALID_DWIGITAL_DISPLAY_CONFIG',`${name} tidak valid.`);
  }

  const text=value.trim();

  if(text.length<minimum||text.length>maximum){
    throw displayError('INVALID_DWIGITAL_DISPLAY_CONFIG',`${name} tidak valid.`);
  }

  return text;
}

function safeOrder(value,name='Urutan'){
  const number=Number(value);

  if(!Number.isSafeInteger(number)||number<0||number>100000){
    throw displayError('INVALID_DWIGITAL_DISPLAY_CONFIG',`${name} tidak valid.`);
  }

  return number;
}

function safePrice(value){
  if(value===null||value===undefined||value==='')return null;

  const number=Number(value);

  if(!Number.isSafeInteger(number)||number<0){
    throw displayError('INVALID_DWIGITAL_DISPLAY_PRICE','Harga jual harus bilangan bulat >= 0.');
  }

  return number;
}

function normalizeProviderProductSettings({
  type,
  providerProductId,
  input,
  sourceVariants
}={}){
  if(!['digital','game'].includes(type)){
    throw displayError('INVALID_DWIGITAL_PROVIDER_TYPE','Tipe provider tidak didukung.');
  }

  const productId=cleanText(
    providerProductId,
    'Provider product ID',
    {minimum:1,maximum:128}
  );

  if(!CATEGORY_KEYS[type].has(input?.categoryKey)){
    throw displayError('INVALID_DWIGITAL_DISPLAY_CATEGORY','Kategori tidak sesuai tipe produk.');
  }

  const displayName=cleanText(input?.displayName,'Nama tampilan',{minimum:2});
  const sortOrder=safeOrder(input?.sortOrder);
  const isVisible=input?.isVisible===true;

  if(!Array.isArray(sourceVariants)||sourceVariants.length===0){
    throw displayError('DWIGITAL_PROVIDER_PRODUCT_NOT_FOUND','Varian provider tidak ditemukan.',404);
  }

  if(!Array.isArray(input?.variants)||input.variants.length!==sourceVariants.length){
    throw displayError('INVALID_DWIGITAL_DISPLAY_VARIANTS','Daftar varian tidak lengkap.');
  }

  const sourceById=new Map();

  for(const source of sourceVariants){
    if(
      !source ||
      typeof source.variant_id!=='string' ||
      !source.variant_id.trim() ||
      sourceById.has(source.variant_id)
    ){
      throw displayError('INVALID_DWIGITAL_DISPLAY_VARIANTS','Data varian provider tidak valid.');
    }

    const basePrice=Number(source.base_price);

    if(!Number.isSafeInteger(basePrice)||basePrice<0){
      throw displayError('INVALID_DWIGITAL_DISPLAY_VARIANTS','Harga modal provider tidak valid.');
    }

    sourceById.set(source.variant_id,{basePrice});
  }

  const seen=new Set();

  const variants=input.variants.map(variant=>{
    const variantId=cleanText(
      variant?.variantId,
      'Variant ID',
      {minimum:1,maximum:128}
    );

    const source=sourceById.get(variantId);

    if(!source||seen.has(variantId)){
      throw displayError('INVALID_DWIGITAL_DISPLAY_VARIANTS','Varian tidak dikenal atau duplikat.');
    }

    seen.add(variantId);

    const retailPrice=safePrice(variant.retailPrice);
    const variantVisible=variant.isVisible===true;

    if(retailPrice!==null&&retailPrice<source.basePrice){
      throw displayError(
        'DWIGITAL_RETAIL_PRICE_BELOW_COST',
        'Harga jual tidak boleh lebih rendah dari harga modal provider.'
      );
    }

    if(variantVisible&&retailPrice===null){
      throw displayError(
        'DWIGITAL_VISIBLE_VARIANT_WITHOUT_PRICE',
        'Varian yang ditampilkan wajib memiliki harga jual.'
      );
    }

    return {
      variantId,
      displayName:cleanText(
        variant.displayName,
        'Nama varian',
        {minimum:0,maximum:160,nullable:true}
      ),
      retailPrice,
      sortOrder:safeOrder(variant.sortOrder,'Urutan varian'),
      isVisible:variantVisible,
      basePrice:source.basePrice,
      margin:retailPrice===null?null:retailPrice-source.basePrice
    };
  });

  if(seen.size!==sourceById.size){
    throw displayError('INVALID_DWIGITAL_DISPLAY_VARIANTS','Ada varian provider yang belum dikonfigurasi.');
  }

  if(isVisible&&!variants.some(variant=>variant.isVisible&&variant.retailPrice!==null)){
    throw displayError(
      'DWIGITAL_VISIBLE_PRODUCT_WITHOUT_VARIANT',
      'Produk yang ditampilkan wajib memiliki minimal satu varian dengan harga jual.'
    );
  }

  return {
    providerType:type,
    providerProductId:productId,
    categoryKey:input.categoryKey,
    displayName,
    sortOrder,
    isVisible,
    variants
  };
}

async function listCategories({includeInactive=true}={}){
  const result=await query(
    `SELECT
       category_key,
       name,
       parent_key,
       icon_key,
       sort_order,
       is_active
     FROM dwigital_display_categories
     WHERE $1::boolean OR is_active=true
     ORDER BY
       CASE WHEN parent_key IS NULL THEN 0 ELSE 1 END,
       sort_order,
       name`,
    [includeInactive===true]
  );

  return result.rows;
}

async function listProviderProducts({
  type,
  search='',
  limit=50,
  offset=0
}={}){
  if(!['digital','game'].includes(type)){
    throw displayError('INVALID_DWIGITAL_PROVIDER_TYPE','Tipe provider tidak didukung.');
  }

  const safeLimit=Math.max(1,Math.min(100,Number.isSafeInteger(Number(limit))?Number(limit):50));
  const safeOffset=Math.max(0,Math.min(1000000,Number.isSafeInteger(Number(offset))?Number(offset):0));
  const term=String(search||'').trim();

  const result=await query(
    `SELECT
       product.provider_type,
       product.provider_product_id,
       product.display_name,
       product.category_key,
       product.sort_order,
       product.is_visible,
       category.name AS category_name,
       COUNT(variant.variant_id)::integer AS variant_count,
       COUNT(variant.variant_id) FILTER (
         WHERE variant.is_visible=true
           AND variant.retail_price IS NOT NULL
       )::integer AS visible_variant_count,
       MIN(variant.retail_price) FILTER (
         WHERE variant.is_visible=true
           AND variant.retail_price IS NOT NULL
       ) AS minimum_retail_price
     FROM dwigital_display_products product
     JOIN dwigital_display_categories category
       ON category.category_key=product.category_key
     LEFT JOIN dwigital_display_variants variant
       ON variant.provider_type=product.provider_type
      AND variant.provider_product_id=product.provider_product_id
     WHERE product.provider_type=$1
       AND (
         $2=''
         OR product.display_name ILIKE '%'||$2||'%'
         OR product.provider_product_id ILIKE '%'||$2||'%'
       )
     GROUP BY
       product.provider_type,
       product.provider_product_id,
       product.display_name,
       product.category_key,
       product.sort_order,
       product.is_visible,
       category.name,
       category.sort_order
     ORDER BY category.sort_order,product.sort_order,product.display_name
     LIMIT $3 OFFSET $4`,
    [type,term,safeLimit,safeOffset]
  );

  return result.rows;
}

async function countProviderProducts({type,search=''}={}){
  if(!['digital','game'].includes(type)){
    throw displayError('INVALID_DWIGITAL_PROVIDER_TYPE','Tipe provider tidak didukung.');
  }

  const result=await query(
    `SELECT COUNT(*)::integer AS count
     FROM dwigital_display_products
     WHERE provider_type=$1
       AND (
         $2=''
         OR display_name ILIKE '%'||$2||'%'
         OR provider_product_id ILIKE '%'||$2||'%'
       )`,
    [type,String(search||'').trim()]
  );

  return Number(result.rows[0]?.count||0);
}

async function findProviderProduct(type,providerProductId){
  if(!['digital','game'].includes(type)){
    throw displayError('INVALID_DWIGITAL_PROVIDER_TYPE','Tipe provider tidak didukung.');
  }

  const productResult=await query(
    `SELECT
       product.*,
       category.name AS category_name,
       category.parent_key AS category_parent_key,
       category.icon_key AS category_icon_key
     FROM dwigital_display_products product
     JOIN dwigital_display_categories category
       ON category.category_key=product.category_key
     WHERE product.provider_type=$1
       AND product.provider_product_id=$2`,
    [type,String(providerProductId)]
  );

  const product=productResult.rows[0];

  if(!product)return null;

  const variantResult=await query(
    `SELECT
       source.variant_id,
       source.payload->>'name' AS source_name,
       source.payload->>'product' AS source_product,
       source.payload->>'delivery' AS delivery,
       source.payload->'fields' AS fields,
       source.payload->>'target_label' AS target_label,
       source.payload->>'zone_required' AS zone_required,
       (source.payload->>'price')::bigint AS base_price,
       COALESCE(variant.display_name,source.payload->>'name') AS display_name,
       variant.retail_price,
       COALESCE(variant.sort_order,0) AS sort_order,
       COALESCE(variant.is_visible,false) AS is_visible,
       variant.icon_path
     FROM dwigital_catalog source
     LEFT JOIN dwigital_display_variants variant
       ON variant.variant_id=source.variant_id
     WHERE source.type=$1
       AND source.is_active=true
       AND source.payload->>'product_id'=$2
     ORDER BY COALESCE(variant.sort_order,0),source.variant_id`,
    [type,String(providerProductId)]
  );

  return {...product,variants:variantResult.rows};
}

async function saveProviderProduct(type,providerProductId,input){
  const current=await findProviderProduct(type,providerProductId);

  if(!current){
    throw displayError('DWIGITAL_PROVIDER_PRODUCT_NOT_FOUND','Produk provider tidak ditemukan.',404);
  }

  const categoryResult=await query(
    `SELECT category_key,parent_key,is_active
     FROM dwigital_display_categories
     WHERE category_key=$1`,
    [input?.categoryKey]
  );

  const category=categoryResult.rows[0];

  if(
    !category ||
    category.is_active!==true ||
    category.parent_key!==ROOT_BY_TYPE[type]
  ){
    throw displayError('INVALID_DWIGITAL_DISPLAY_CATEGORY','Kategori tidak sesuai tipe produk.');
  }

  const normalized=normalizeProviderProductSettings({
    type,
    providerProductId,
    input,
    sourceVariants:current.variants.map(variant=>({
      variant_id:variant.variant_id,
      base_price:variant.base_price
    }))
  });

  const variantsJson=JSON.stringify(normalized.variants.map(variant=>({
    variant_id:variant.variantId,
    display_name:variant.displayName,
    retail_price:variant.retailPrice,
    sort_order:variant.sortOrder,
    is_visible:variant.isVisible
  })));

  await withTransaction(async(client)=>{
    await client.query(
      `UPDATE dwigital_display_products
       SET
         category_key=$3,
         display_name=$4,
         sort_order=$5,
         is_visible=$6,
         updated_at=now()
       WHERE provider_type=$1
         AND provider_product_id=$2`,
      [
        type,
        String(providerProductId),
        normalized.categoryKey,
        normalized.displayName,
        normalized.sortOrder,
        normalized.isVisible
      ]
    );

    await client.query(
      `INSERT INTO dwigital_display_variants (
         provider_type,
         provider_product_id,
         variant_id,
         display_name,
         retail_price,
         sort_order,
         is_visible
       )
       SELECT
         $1,
         $2,
         incoming.variant_id,
         incoming.display_name,
         incoming.retail_price,
         incoming.sort_order,
         incoming.is_visible
       FROM jsonb_to_recordset($3::jsonb) AS incoming(
         variant_id text,
         display_name text,
         retail_price bigint,
         sort_order integer,
         is_visible boolean
       )
       ON CONFLICT (variant_id) DO UPDATE
       SET
         provider_type=EXCLUDED.provider_type,
         provider_product_id=EXCLUDED.provider_product_id,
         display_name=EXCLUDED.display_name,
         retail_price=EXCLUDED.retail_price,
         sort_order=EXCLUDED.sort_order,
         is_visible=EXCLUDED.is_visible,
         updated_at=now()`,
      [type,String(providerProductId),variantsJson]
    );
  });

  return findProviderProduct(type,providerProductId);
}

async function updateCategory(categoryKey,input){
  const name=cleanText(input?.name,'Nama kategori',{minimum:2,maximum:100});
  const iconKey=cleanText(
    input?.iconKey,
    'Icon kategori',
    {minimum:0,maximum:100,nullable:true}
  );
  const sortOrder=safeOrder(input?.sortOrder);
  const isActive=input?.isActive===true;

  const result=await query(
    `UPDATE dwigital_display_categories
     SET
       name=$2,
       icon_key=$3,
       sort_order=$4,
       is_active=$5,
       updated_at=now()
     WHERE category_key=$1
     RETURNING category_key,name,parent_key,icon_key,sort_order,is_active`,
    [categoryKey,name,iconKey,sortOrder,isActive]
  );

  if(!result.rows[0]){
    throw displayError('DWIGITAL_DISPLAY_CATEGORY_NOT_FOUND','Kategori katalog tidak ditemukan.',404);
  }

  return result.rows[0];
}


async function updateMediaPath(type,providerProductId,{
  contentType,
  variantId=null,
  path
}={}){
  if(!['digital','game'].includes(type)){
    throw displayError('INVALID_DWIGITAL_PROVIDER_TYPE','Tipe provider tidak didukung.');
  }

  if(!['THUMBNAIL','VARIANT_ICON'].includes(contentType)){
    throw displayError('INVALID_DWIGITAL_MEDIA_TYPE','Tipe media tidak didukung.');
  }

  if(typeof path!=='string'||!path.startsWith(`dwigital/${type}/${providerProductId}/`)){
    throw displayError('INVALID_DWIGITAL_MEDIA_PATH','Path media tidak valid.');
  }

  return withTransaction(async(client)=>{
    if(contentType==='THUMBNAIL'){
      const current=await client.query(
        `SELECT cover_path
         FROM dwigital_display_products
         WHERE provider_type=$1 AND provider_product_id=$2
         FOR UPDATE`,
        [type,String(providerProductId)]
      );

      if(!current.rows[0])return null;

      await client.query(
        `UPDATE dwigital_display_products
         SET cover_path=$3,updated_at=now()
         WHERE provider_type=$1 AND provider_product_id=$2`,
        [type,String(providerProductId),path]
      );

      return {previousPath:current.rows[0].cover_path||null,path};
    }

    const current=await client.query(
      `SELECT icon_path
       FROM dwigital_display_variants
       WHERE variant_id=$1
         AND provider_type=$2
         AND provider_product_id=$3
       FOR UPDATE`,
      [String(variantId||''),type,String(providerProductId)]
    );

    if(!current.rows[0])return null;

    await client.query(
      `UPDATE dwigital_display_variants
       SET icon_path=$2,updated_at=now()
       WHERE variant_id=$1
         AND provider_type=$3
         AND provider_product_id=$4`,
      [String(variantId),path,type,String(providerProductId)]
    );

    return {previousPath:current.rows[0].icon_path||null,path};
  });
}

async function isMediaReferenced(path){
  if(typeof path!=='string'||!path)return false;

  const result=await query(
    `SELECT
       EXISTS(
         SELECT 1 FROM dwigital_display_products
         WHERE cover_path=$1
       )
       OR EXISTS(
         SELECT 1 FROM dwigital_display_variants
         WHERE icon_path=$1
       ) AS referenced`,
    [path]
  );

  return result.rows[0]?.referenced===true;
}


async function listPublicCatalog(){
  const result=await query(
    `SELECT
       root.category_key AS root_key,
       root.name AS root_name,
       root.icon_key AS root_icon_key,
       root.sort_order AS root_sort_order,
       category.category_key,
       category.name AS category_name,
       category.icon_key AS category_icon_key,
       category.sort_order AS category_sort_order,
       product.provider_product_id AS product_group_key,
       product.display_name,
       product.sort_order AS product_sort_order,
       product.cover_path,
       COALESCE(variant.display_name,source.payload->>'name') AS variant_name,
       variant.retail_price,
       variant.sort_order AS variant_sort_order,
       variant.icon_path
     FROM dwigital_display_categories root
     JOIN dwigital_display_categories category
       ON category.parent_key=root.category_key
     JOIN dwigital_display_products product
       ON product.category_key=category.category_key
     JOIN dwigital_display_variants variant
       ON variant.provider_type=product.provider_type
      AND variant.provider_product_id=product.provider_product_id
     JOIN dwigital_catalog source
       ON source.variant_id=variant.variant_id
      AND source.type=product.provider_type
      AND source.is_active=true
     WHERE root.category_key IN ('premium','game')
       AND root.parent_key IS NULL
       AND root.is_active=true
       AND category.is_active=true
       AND product.is_visible=true
       AND variant.is_visible=true
       AND variant.retail_price IS NOT NULL
       AND (
         (root.category_key='premium' AND product.provider_type='digital')
         OR
         (root.category_key='game' AND product.provider_type='game')
       )
       AND source.payload->>'product_id'=product.provider_product_id
     ORDER BY
       root.sort_order,
       category.sort_order,
       product.sort_order,
       product.display_name,
       variant.sort_order,
       variant.variant_id`,
    []
  );

  const roots=new Map();

  for(const row of result.rows){
    let root=roots.get(row.root_key);

    if(!root){
      root={
        category_key:row.root_key,
        name:row.root_name,
        icon_key:row.root_icon_key,
        subcategories:[],
        _categories:new Map()
      };
      roots.set(row.root_key,root);
    }

    let category=root._categories.get(row.category_key);

    if(!category){
      category={
        category_key:row.category_key,
        name:row.category_name,
        icon_key:row.category_icon_key,
        products:[],
        _products:new Map()
      };
      root._categories.set(row.category_key,category);
      root.subcategories.push(category);
    }

    let product=category._products.get(row.product_group_key);

    if(!product){
      product={
        display_name:row.display_name,
        cover_path:row.cover_path,
        variants:[]
      };
      category._products.set(row.product_group_key,product);
      category.products.push(product);
    }

    product.variants.push({
      display_name:row.variant_name,
      retail_price:Number(row.retail_price),
      icon_path:row.icon_path
    });
  }

  return Array.from(roots.values()).map(root=>{
    delete root._categories;

    root.subcategories=root.subcategories.map(category=>{
      delete category._products;
      return category;
    });

    return root;
  });
}

module.exports={
  normalizeProviderProductSettings,
  listPublicCatalog,
  updateMediaPath,
  isMediaReferenced,
  listCategories,
  listProviderProducts,
  countProviderProducts,
  findProviderProduct,
  saveProviderProduct,
  updateCategory
};
