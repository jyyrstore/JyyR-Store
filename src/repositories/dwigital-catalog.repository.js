const {query,withTransaction}=require('../config/database');
const {PRODUCT_TYPES}=require('../services/dwigital/dwigital.service');

function snapshotError(code,message){
  const error=new Error(message);
  error.code=code;
  error.status=400;
  error.expose=true;
  return error;
}

function prepareSnapshot(products){
  if(!Array.isArray(products)||products.length===0){
    throw snapshotError(
      'INVALID_DWIGITAL_CATALOG_SNAPSHOT',
      'Snapshot katalog Dwigital harus berupa array yang tidak kosong.'
    );
  }

  const seen=new Set();

  const rows=products.map(product=>{
    if(
      !product||
      typeof product!=='object'||
      Array.isArray(product)||
      typeof product.variant_id!=='string'||
      !product.variant_id.trim()||
      product.variant_id!==product.variant_id.trim()||
      product.variant_id.length>128||
      typeof product.type!=='string'||
      !PRODUCT_TYPES.includes(product.type)
    ){
      throw snapshotError(
        'INVALID_DWIGITAL_CATALOG_SNAPSHOT',
        'Item snapshot katalog Dwigital tidak valid.'
      );
    }

    if(seen.has(product.variant_id)){
      throw snapshotError(
        'DUPLICATE_DWIGITAL_VARIANT_ID',
        'Snapshot katalog Dwigital memiliki variant ID duplikat.'
      );
    }

    seen.add(product.variant_id);

    return {
      variant_id:product.variant_id,
      type:product.type,
      payload:product
    };
  });

  let snapshotJson;

  try{
    snapshotJson=JSON.stringify(rows);
  }catch{
    throw snapshotError(
      'INVALID_DWIGITAL_CATALOG_SNAPSHOT',
      'Payload snapshot katalog Dwigital tidak dapat diserialisasi.'
    );
  }

  if(typeof snapshotJson!=='string'){
    throw snapshotError(
      'INVALID_DWIGITAL_CATALOG_SNAPSHOT',
      'Payload snapshot katalog Dwigital tidak valid.'
    );
  }

  return {
    variantIds:[...seen],
    snapshotJson
  };
}

async function replaceSnapshot(products){
  const {variantIds,snapshotJson}=prepareSnapshot(products);

  return withTransaction(async(client)=>{
    await client.query(
      "select pg_advisory_xact_lock(hashtext('jyyrstore:dwigital_catalog:snapshot'))"
    );

    await client.query(
      `INSERT INTO dwigital_catalog (
         variant_id,
         type,
         payload,
         is_active,
         synced_at,
         created_at,
         updated_at
       )
       SELECT
         incoming.variant_id,
         incoming.type,
         incoming.payload,
         true,
         now(),
         now(),
         now()
       FROM jsonb_to_recordset($1::jsonb) AS incoming(
         variant_id text,
         type text,
         payload jsonb
       )
       ON CONFLICT (variant_id) DO UPDATE
       SET
         type=EXCLUDED.type,
         payload=EXCLUDED.payload,
         is_active=true,
         synced_at=now(),
         updated_at=now()`,
      [snapshotJson]
    );

    const deactivated=await client.query(
      `UPDATE dwigital_catalog
       SET
         is_active=false,
         updated_at=now()
       WHERE is_active=true
         AND NOT (variant_id=ANY($1::text[]))`,
      [variantIds]
    );

    return {
      syncedCount:variantIds.length,
      deactivatedCount:Number(deactivated.rowCount||0)
    };
  });
}


function validLeaseToken(value){
  return typeof value==='string'&&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function boundedMinutes(value,fallback,minimum,maximum){
  const number=Number(value);

  if(!Number.isSafeInteger(number)){
    return fallback;
  }

  return Math.max(minimum,Math.min(maximum,number));
}

async function claimSync({leaseToken,leaseMinutes=15}={}){
  if(!validLeaseToken(leaseToken)){
    throw new TypeError('Dwigital sync lease token tidak valid.');
  }

  const duration=boundedMinutes(leaseMinutes,15,1,30);

  return withTransaction(async(client)=>{
    await client.query(
      "select pg_advisory_xact_lock(hashtext('jyyrstore:dwigital_catalog:sync_state'))"
    );

    await client.query(
      `INSERT INTO dwigital_catalog_sync_state(id)
       VALUES(1)
       ON CONFLICT(id) DO NOTHING`
    );

    const claimed=await client.query(
      `UPDATE dwigital_catalog_sync_state
       SET
         lease_token=$1::uuid,
         lease_expires_at=now()+($2::int*interval '1 minute'),
         updated_at=now()
       WHERE id=1
         AND next_sync_at<=now()
         AND (
           lease_expires_at IS NULL
           OR lease_expires_at<=now()
         )
       RETURNING id`,
      [leaseToken,duration]
    );

    return {acquired:claimed.rowCount===1};
  });
}

async function completeSync({leaseToken,intervalMinutes=360}={}){
  if(!validLeaseToken(leaseToken)){
    throw new TypeError('Dwigital sync lease token tidak valid.');
  }

  const interval=boundedMinutes(intervalMinutes,360,60,10080);

  const completed=await query(
    `UPDATE dwigital_catalog_sync_state
     SET
       last_synced_at=now(),
       next_sync_at=now()+($2::int*interval '1 minute'),
       lease_token=NULL,
       lease_expires_at=NULL,
       last_error_code=NULL,
       last_error_at=NULL,
       updated_at=now()
     WHERE id=1
       AND lease_token=$1::uuid
       AND lease_expires_at>now()
     RETURNING id`,
    [leaseToken,interval]
  );

  if(completed.rowCount!==1){
    const error=new Error('Dwigital sync lease sudah tidak berlaku.');
    error.code='DWIGITAL_SYNC_LEASE_LOST';
    throw error;
  }

  return {completed:true};
}

async function failSync({
  leaseToken,
  errorCode='DWIGITAL_SYNC_FAILED',
  retryMinutes=15
}={}){
  if(!validLeaseToken(leaseToken)){
    throw new TypeError('Dwigital sync lease token tidak valid.');
  }

  const retry=boundedMinutes(retryMinutes,15,1,60);
  const suppliedCode=String(errorCode||'DWIGITAL_SYNC_FAILED').toUpperCase();
  const safeCode=/^[A-Z0-9_]{1,64}$/.test(suppliedCode)
    ? suppliedCode
    : 'DWIGITAL_SYNC_FAILED';

  const failed=await query(
    `UPDATE dwigital_catalog_sync_state
     SET
       next_sync_at=now()+($2::int*interval '1 minute'),
       lease_token=NULL,
       lease_expires_at=NULL,
       last_error_code=$3,
       last_error_at=now(),
       updated_at=now()
     WHERE id=1
       AND lease_token=$1::uuid
     RETURNING id`,
    [leaseToken,retry,safeCode]
  );

  return {released:failed.rowCount===1};
}

module.exports={replaceSnapshot,claimSync,completeSync,failSync};
