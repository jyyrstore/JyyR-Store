const {PRODUCT_TYPES}=require('./dwigital.service');

const MAX_VARIANT_ID_LENGTH=128;
const MAX_PRODUCT_TEXT_LENGTH=500;
const MAX_PRODUCT_NAME_LENGTH=300;
const MAX_PRODUCT_NOTE_LENGTH=3000;
const MAX_FIELD_COUNT=50;

function hasControlCharacters(value,{allowWhitespace=false}={}){
  for(const character of value){
    const code=character.codePointAt(0);

    if(
      code<32&&
      !(
        allowWhitespace&&
        (code===9||code===10||code===13)
      )
    ){
      return true;
    }
  }

  return false;
}

function catalogError(code,message,status=502){
  const error=new Error(message);
  error.code=code;
  error.status=status;
  error.expose=false;
  return error;
}

function optionalText(value,name,maxLength=MAX_PRODUCT_TEXT_LENGTH){
  if(value===undefined||value===null)return null;

  if(typeof value!=='string'&&typeof value!=='number'){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_PRODUCT',
      `${name} katalog Dwigital tidak valid.`
    );
  }

  const text=String(value).trim();

  if(text.length>maxLength||hasControlCharacters(text,{allowWhitespace:true})){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_PRODUCT',
      `${name} katalog Dwigital melebihi batas atau mengandung karakter kontrol.`
    );
  }

  return text||null;
}

function optionalInteger(value,name,{minimum=0,required=false}={}){
  if(value===undefined||value===null||value===''){
    if(required){
      throw catalogError(
        'INVALID_DWIGITAL_CATALOG_PRODUCT',
        `${name} katalog Dwigital wajib berupa bilangan bulat.`
      );
    }

    return null;
  }

  const number=Number(value);

  if(!Number.isSafeInteger(number)||number<minimum){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_PRODUCT',
      `${name} katalog Dwigital tidak valid.`
    );
  }

  return number;
}

function optionalBoolean(value,name,fallback=false){
  if(value===undefined||value===null)return fallback;

  if(typeof value!=='boolean'){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_PRODUCT',
      `${name} katalog Dwigital harus berupa boolean.`
    );
  }

  return value;
}

function normalizeFields(value){
  if(value===undefined||value===null)return [];

  if(!Array.isArray(value)||value.length>MAX_FIELD_COUNT){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_PRODUCT',
      'Metadata fields katalog Dwigital tidak valid.'
    );
  }

  return value.map((field,index)=>{
    if(!field||typeof field!=='object'||Array.isArray(field)){
      throw catalogError(
        'INVALID_DWIGITAL_CATALOG_PRODUCT',
        `Field katalog Dwigital pada posisi ${index+1} tidak valid.`
      );
    }

    const name=optionalText(field.name,'field.name',64);
    const label=optionalText(field.label,'field.label',160);

    if(!name||! /^[A-Za-z][A-Za-z0-9_]*$/.test(name)||!label){
      throw catalogError(
        'INVALID_DWIGITAL_CATALOG_PRODUCT',
        `Nama atau label field katalog Dwigital pada posisi ${index+1} tidak valid.`
      );
    }

    return {
      name,
      label,
      required:optionalBoolean(field.required,'field.required',false),
      example:optionalText(field.example,'field.example',300),
      hint:optionalText(field.hint,'field.hint',500),
      pattern:optionalText(field.pattern,'field.pattern',500)
    };
  });
}

function normalizeProduct(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_PRODUCT',
      'Item katalog Dwigital tidak berbentuk object.'
    );
  }

  const variantId=optionalText(
    raw.variant_id,
    'variant_id',
    MAX_VARIANT_ID_LENGTH
  );

  const type=optionalText(raw.type,'type',32)?.toLowerCase();

  if(
    !variantId||
    hasControlCharacters(variantId)||
    !PRODUCT_TYPES.includes(type)
  ){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_PRODUCT',
      'Variant ID atau tipe katalog Dwigital tidak valid.'
    );
  }

  const price=optionalInteger(
    raw.price,
    'price',
    {minimum:0,required:true}
  );

  const priceUnit=String(raw.price_unit||'per_order')
    .trim()
    .toLowerCase();

  if(!['per_order','per_1000'].includes(priceUnit)){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_PRODUCT',
      'Satuan harga katalog Dwigital tidak didukung.'
    );
  }

  const minQty=optionalInteger(raw.min_qty,'min_qty',{minimum:1});
  const maxQty=optionalInteger(raw.max_qty,'max_qty',{minimum:1});

  if(priceUnit==='per_1000'&&(minQty===null||maxQty===null)){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_PRODUCT',
      'Batas kuantitas paket Dwigital tidak valid.'
    );
  }

  const quantityBoundsValid=
    minQty===null||maxQty===null||minQty<=maxQty;

  const stock=optionalInteger(raw.stock,'stock',{minimum:0});
  const delivery=optionalText(raw.delivery,'delivery',32)?.toLowerCase()||null;

  if(delivery&&!['automatic','manual'].includes(delivery)){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_PRODUCT',
      'Mode delivery paket Dwigital tidak valid.'
    );
  }

  const noteValue=typeof raw.note==='string'
    ? raw.note.split(String.fromCharCode(8)).join(' ')
    : raw.note;
  const note=optionalText(
    noteValue,
    'note',
    MAX_PRODUCT_NOTE_LENGTH
  );

  return {
    variant_id:variantId,
    code:optionalText(raw.code,'code',128),
    product_id:optionalText(raw.product_id,'product_id',128),
    type,
    product:optionalText(raw.product,'product',160),
    name:optionalText(raw.name,'name',MAX_PRODUCT_NAME_LENGTH),
    price,
    price_unit:priceUnit,
    min_qty:minQty,
    max_qty:maxQty,
    quantity_bounds_valid:quantityBoundsValid,
    target_label:optionalText(raw.target_label,'target_label',160),
    zone_required:optionalBoolean(raw.zone_required,'zone_required',false),
    zone_label:optionalText(raw.zone_label,'zone_label',160),
    extra_field:optionalText(raw.extra_field,'extra_field',160),
    nickname_check:optionalBoolean(raw.nickname_check,'nickname_check',false),
    fields:normalizeFields(raw.fields),
    delivery,
    stock,
    note
  };
}

function validateDependencies({client,repository}={}){
  if(typeof client?.listAllProducts!=='function'){
    throw new TypeError('Dwigital client.listAllProducts wajib tersedia.');
  }

  if(typeof repository?.replaceSnapshot!=='function'){
    throw new TypeError('Dwigital repository.replaceSnapshot wajib tersedia.');
  }
}

async function syncCatalog({client,repository}={}){
  validateDependencies({client,repository});

  // Ambil seluruh kategori dan halaman sebelum ada operasi persistensi.
  const sourceProducts=await client.listAllProducts();

  if(!Array.isArray(sourceProducts)||sourceProducts.length===0){
    throw catalogError(
      'INVALID_DWIGITAL_CATALOG_RESPONSE',
      'Snapshot katalog Dwigital kosong atau tidak valid.'
    );
  }

  const seenVariantIds=new Set();
  const normalized=[];

  for(const raw of sourceProducts){
    const product=normalizeProduct(raw);

    if(seenVariantIds.has(product.variant_id)){
      throw catalogError(
        'DUPLICATE_DWIGITAL_VARIANT_ID',
        'Dwigital mengembalikan variant ID duplikat.'
      );
    }

    seenVariantIds.add(product.variant_id);
    normalized.push(product);
  }

  // Repository bertanggung jawab mengganti snapshot secara atomik.
  const persisted=await repository.replaceSnapshot(normalized);

  return {
    syncedCount:normalized.length,
    deactivatedCount:Number(persisted?.deactivatedCount||0)
  };
}

module.exports={
  syncCatalog,
  normalizeProduct
};
