const {loadEnv}=require('../../config/env');
const {encrypt,decrypt,randomId}=require('../../utils/crypto');
const {createDwigitalClient}=require('./dwigital.service');
const displayRepository=require('../../repositories/dwigital-display.repository');
const repository=require('../../repositories/dwigital-orders.repository');
const defaultRefundService=require('../refund.service');
const {log}=require('../../config/logging');

function purchaseError(code,message,status=400){
  const error=new Error(message);
  error.code=code;
  error.status=status;
  error.expose=status<500;
  return error;
}

function isEnabled(value){
  if(value===true||value===1)return true;
  return ['true','1','yes','on'].includes(
    String(value??'').trim().toLowerCase()
  );
}

function defaultOrderNumber(){
  const date=new Date().toISOString().slice(0,10).replace(/-/g,'');
  return `JYR-${date}-${randomId().slice(-6).toUpperCase()}`;
}

function validateField(field,value){
  const text=String(value??'').trim();

  if(field.required===true&&!text){
    throw purchaseError(
      'DWIGITAL_TARGET_REQUIRED',
      `${field.label||field.name} wajib diisi.`
    );
  }

  if(!text)return '';

  const hasControlCharacter=Array.from(text).some(character=>{
    const code=character.charCodeAt(0);
    return code<=0x1f||code===0x7f;
  });

  if(text.length>254||hasControlCharacter){
    throw purchaseError(
      'DWIGITAL_TARGET_INVALID',
      `${field.label||field.name} tidak valid.`
    );
  }

  if(field.pattern){
    let pattern;

    try{
      pattern=new RegExp(field.pattern);
    }catch{
      throw purchaseError(
        'DWIGITAL_FIELD_SCHEMA_INVALID',
        'Format input paket Dwigital tidak valid.',
        502
      );
    }

    if(!pattern.test(text)){
      throw purchaseError(
        'DWIGITAL_TARGET_INVALID',
        `${field.label||field.name} tidak sesuai format paket.`
      );
    }
  }

  return text;
}

function createDwigitalPurchaseService(dependencies={}){
  const env=dependencies.env||loadEnv();
  const clientFactory=dependencies.clientFactory||(
    ()=>createDwigitalClient({
      apiKey:env.DWIGITAL_API_KEY,
      baseUrl:env.DWIGITAL_API_BASE_URL
    })
  );
  const display=dependencies.displayRepository||displayRepository;
  const orders=dependencies.repository||repository;
  const generateOrderNumber=
    dependencies.generateOrderNumber||defaultOrderNumber;
  const encryptionKey=String(env.ENCRYPTION_KEY||'');

  async function createOrder(input={}){
    const userId=String(input.userId||'').trim();
    const idempotencyKey=String(input.idempotencyKey||'').trim();
    const type=String(input.type||'').trim().toLowerCase();
    const productId=String(input.productId||'').trim();
    const variantId=String(input.variantId||'').trim();
    const paymentMethod=String(input.paymentMethod||'BALANCE')
      .trim()
      .toUpperCase();

    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)){
      throw purchaseError('INVALID_USER','Pengguna tidak valid.');
    }

    if(idempotencyKey.length<8||idempotencyKey.length>100){
      throw purchaseError(
        'INVALID_IDEMPOTENCY_KEY',
        'Kunci idempotensi pembelian tidak valid.'
      );
    }

    if(!['digital','game'].includes(type)){
      throw purchaseError(
        'INVALID_DWIGITAL_PRODUCT_TYPE',
        'Tipe produk Dwigital tidak didukung.'
      );
    }

    if(
      !/^[A-Za-z0-9_-]{1,128}$/.test(productId)||
      !/^[A-Za-z0-9_-]{1,128}$/.test(variantId)
    ){
      throw purchaseError(
        'INVALID_DWIGITAL_VARIANT',
        'Produk atau varian Dwigital tidak valid.'
      );
    }

    if(!['BALANCE','GATEWAY'].includes(paymentMethod)){
      throw purchaseError(
        'INVALID_PAYMENT_METHOD',
        'Metode pembayaran Dwigital tidak valid.'
      );
    }


    const decodedKey=Buffer.from(encryptionKey,'base64');

    if(decodedKey.length!==32){
      throw purchaseError(
        'DWIGITAL_ENCRYPTION_NOT_CONFIGURED',
        'ENCRYPTION_KEY wajib dikonfigurasi untuk pembelian Dwigital.',
        503
      );
    }

    const providerProduct=await display.findProviderProduct(
      type,
      productId,
      {publicOnly:true}
    );

    if(!providerProduct){
      throw purchaseError(
        'DWIGITAL_PRODUCT_UNAVAILABLE',
        'Produk Dwigital tidak tersedia.',
        404
      );
    }

    const variant=(providerProduct.variants||[]).find(
      item=>String(item.variant_id)===variantId
    );

    if(!variant||variant.is_visible!==true){
      throw purchaseError(
        'DWIGITAL_VARIANT_UNAVAILABLE',
        'Varian Dwigital tidak tersedia.',
        404
      );
    }

    if(providerProduct.is_visible===false){
      throw purchaseError(
        'DWIGITAL_PRODUCT_UNAVAILABLE',
        'Produk Dwigital tidak tersedia untuk dibeli.',
        404
      );
    }

    const client=clientFactory();
    if(typeof client?.getProduct!=='function'){
      throw purchaseError(
        'DWIGITAL_CLIENT_INVALID',
        'Pemeriksaan harga supplier tidak tersedia.',
        503
      );
    }

    const supplier=await client.getProduct(variantId);

    if(!supplier||typeof supplier!=='object'||Array.isArray(supplier)){
      throw purchaseError(
        'DWIGITAL_INVALID_RESPONSE',
        'Detail varian dari supplier tidak valid.',
        502
      );
    }

    if(
      String(supplier.variant_id??'')!==variantId||
      (supplier.type&&String(supplier.type).toLowerCase()!==type)||
      (
        supplier.product_id!==undefined&&
        supplier.product_id!==null&&
        String(supplier.product_id)!==productId
      )
    ){
      throw purchaseError(
        'DWIGITAL_VARIANT_MISMATCH',
        'Identitas varian supplier tidak cocok dengan katalog toko.',
        409
      );
    }

    const supplierPrice=Number(supplier.price);
    const retailPrice=Number(variant.retail_price);

    if(
      !Number.isSafeInteger(supplierPrice)||
      supplierPrice<0||
      !Number.isSafeInteger(retailPrice)||
      retailPrice<=0
    ){
      throw purchaseError(
        'DWIGITAL_PRICE_INVALID',
        'Harga varian Dwigital tidak valid.',
        502
      );
    }

    if(supplierPrice>retailPrice){
      throw purchaseError(
        'DWIGITAL_RETAIL_PRICE_BELOW_COST',
        'Harga modal supplier terbaru melebihi harga jual. Varian tidak dapat dibeli.',
        409
      );
    }

    const priceUnit=String(
      supplier.price_unit||variant.price_unit||'per_order'
    ).toLowerCase();

    if(priceUnit!=='per_order'){
      throw purchaseError(
        'DWIGITAL_PRICE_UNIT_UNSUPPORTED',
        'Satuan harga paket ini belum didukung pada halaman pembelian.',
        409
      );
    }

    const stock=supplier.stock;
    if(stock!==null&&stock!==undefined&&Number(stock)<=0){
      throw purchaseError(
        'DWIGITAL_VARIANT_OUT_OF_STOCK',
        'Stok varian Dwigital sedang habis.',
        409
      );
    }

    const extraField=String(
      supplier.extra_field||variant.extra_field||''
    ).trim();

    if(extraField){
      throw purchaseError(
        'DWIGITAL_EXTRA_FIELD_UNSUPPORTED',
        'Varian ini memerlukan isian tambahan yang belum didukung.',
        409
      );
    }

    const fields=Array.isArray(supplier.fields)
      ? supplier.fields
      : Array.isArray(variant.fields)
        ? variant.fields
        : [];

    const unsupportedField=fields.find(
      field=>
        field&&
        !['target','target_zone'].includes(String(field.name||''))&&
        field.required===true
    );

    if(unsupportedField){
      throw purchaseError(
        'DWIGITAL_EXTRA_FIELD_UNSUPPORTED',
        'Paket ini memerlukan isian tambahan yang belum didukung.',
        409
      );
    }

    const targetField=fields.find(field=>field?.name==='target')||{
      name:'target',
      label:variant.target_label||'Target',
      required:true
    };

    const zoneField=fields.find(field=>field?.name==='target_zone')||{
      name:'target_zone',
      label:variant.zone_label||supplier.zone_label||'Zone',
      required:isEnabled(supplier.zone_required??variant.zone_required)
    };

    const target=validateField(targetField,input.target);
    if(!target){
      throw purchaseError(
        'DWIGITAL_TARGET_REQUIRED',
        'Target akun wajib diisi.'
      );
    }

    const zoneRequired=isEnabled(
      supplier.zone_required??variant.zone_required
    );

    const targetZone=validateField(
      {...zoneField,required:zoneRequired||zoneField.required===true},
      input.targetZone
    );

    if(zoneRequired&&!targetZone){
      throw purchaseError(
        'DWIGITAL_TARGET_ZONE_REQUIRED',
        `${supplier.zone_label||variant.zone_label||'Zone'} wajib diisi.`
      );
    }

    const delivery=String(
      supplier.delivery||variant.delivery||''
    ).toLowerCase();

    if(!['automatic','manual'].includes(delivery)){
      throw purchaseError(
        'DWIGITAL_DELIVERY_INVALID',
        'Metode delivery varian supplier tidak valid.',
        502
      );
    }

    const reference=String(generateOrderNumber());

    if(
      reference.length>64||
      !/^[A-Za-z0-9._-]+$/.test(reference)
    ){
      throw purchaseError(
        'DWIGITAL_REFERENCE_INVALID',
        'Reference transaksi tidak valid.',
        500
      );
    }

    const targetEncrypted=encrypt(
      JSON.stringify({
        target,
        targetZone:targetZone||null
      }),
      encryptionKey
    );

    return orders.createPurchase({
      userId,
      idempotencyKey,
      orderNumber:reference,
      supplierReference:reference,
      paymentMethod,
      type,
      productId,
      variantId,
      productName:String(
        providerProduct.display_name||supplier.product||type
      ).slice(0,300),
      variantName:String(
        variant.display_name||variant.source_name||supplier.name||variantId
      ).slice(0,300),
      targetEncrypted,
      retailPrice,
      supplierPrice,
      maxPrice:supplierPrice,
      delivery
    });
  }


  const refundService=dependencies.refundService||defaultRefundService;

  async function storeSupplierSnapshot(orderId,snapshot,options={}){
    const status=String(snapshot?.status||'').trim().toLowerCase();

    if(!['pending','processing','success','partial','failed'].includes(status)){
      throw purchaseError(
        'DWIGITAL_SUPPLIER_STATUS_INVALID',
        'Status pesanan dari supplier tidak valid.',
        502
      );
    }

    const safeSnapshot={
      status,
      refunded:snapshot.refunded===true,
      ref_id:snapshot.ref_id||null
    };

    if(Object.prototype.hasOwnProperty.call(snapshot,'note')){
      const note=snapshot.note;

      if(note!==null&&note!==undefined){
        if(typeof note!=='string'||Buffer.byteLength(note,'utf8')>10000){
          throw purchaseError(
            'DWIGITAL_SUPPLIER_NOTE_INVALID',
            'Hasil supplier melebihi batas penyimpanan yang diizinkan.',
            502
          );
        }

        safeSnapshot.supplier_note_encrypted=encrypt(note,encryptionKey);
      }else{
        safeSnapshot.supplier_note_encrypted=null;
      }
    }

    if(Object.prototype.hasOwnProperty.call(snapshot,'accounts')){
      if(snapshot.accounts===null){
        safeSnapshot.supplier_accounts_encrypted=null;
      }else{
        let accountsJson;

        try{
          accountsJson=JSON.stringify(snapshot.accounts);
        }catch{
          throw purchaseError(
            'DWIGITAL_SUPPLIER_ACCOUNTS_INVALID',
            'Data delivery supplier tidak valid.',
            502
          );
        }

        if(Buffer.byteLength(accountsJson,'utf8')>50000){
          throw purchaseError(
            'DWIGITAL_SUPPLIER_ACCOUNTS_TOO_LARGE',
            'Data delivery supplier melebihi batas penyimpanan.',
            502
          );
        }

        safeSnapshot.supplier_accounts_encrypted=encrypt(
          accountsJson,
          encryptionKey
        );
      }
    }

    return orders.applySupplierSnapshot(
      orderId,
      safeSnapshot,
      {
        ...options,
        onRefund:async(client,record)=>{
          if(typeof refundService.refundDwigitalOrder!=='function'){
            throw purchaseError(
              'DWIGITAL_REFUND_SERVICE_UNAVAILABLE',
              'Layanan refund Wallet JYYR tidak tersedia.',
              503
            );
          }

          await refundService.refundDwigitalOrder(
            orderId,
            'Pesanan supplier Dwigital gagal dan dana dikembalikan ke Wallet JYYR.',
            client
          );
        }
      }
    );
  }

  async function fulfillOrder(orderId){
    const claim=await orders.claimForSubmission(orderId);

    if(!claim||claim.claimed!==true){
      return {
        orderId,
        submitted:false,
        alreadyClaimed:Boolean(claim),
        supplierStatus:claim?.supplier_status||null
      };
    }

    try{
      const client=clientFactory();

      if(typeof client?.createOrder!=='function'){
        throw purchaseError(
          'DWIGITAL_CREATE_ORDER_UNAVAILABLE',
          'Endpoint pembuatan pesanan supplier tidak tersedia.',
          503
        );
      }

      const decrypted=JSON.parse(
        decrypt(claim.target_encrypted,encryptionKey)
      );

      const target=String(decrypted?.target||'').trim();
      const targetZone=String(decrypted?.targetZone||'').trim();

      if(!target){
        throw purchaseError(
          'DWIGITAL_TARGET_INVALID',
          'Target pesanan yang tersimpan tidak valid.',
          500
        );
      }

      const rawVariantId=String(claim.variant_id);
      const payload={
        reference:claim.supplier_reference,
        variant_id:/^\d+$/.test(rawVariantId)
          ? Number(rawVariantId)
          : rawVariantId,
        target,
        max_price:Number(claim.max_price)
      };

      if(targetZone){
        payload.target_zone=targetZone;
      }

      if(
        !Number.isSafeInteger(payload.max_price)||
        payload.max_price<0
      ){
        throw purchaseError(
          'DWIGITAL_MAX_PRICE_INVALID',
          'Batas harga supplier yang tersimpan tidak valid.',
          500
        );
      }

      const response=await client.createOrder(payload);
      const snapshot=response?.data&&typeof response.data==='object'
        ? response.data
        : response;

      if(
        !snapshot||
        typeof snapshot!=='object'||
        Array.isArray(snapshot)||
        !snapshot.status
      ){
        throw purchaseError(
          'DWIGITAL_INVALID_RESPONSE',
          'Respons pembuatan pesanan supplier tidak lengkap.',
          502
        );
      }

      if(
        snapshot.reference&&
        String(snapshot.reference)!==String(claim.supplier_reference)
      ){
        throw purchaseError(
          'DWIGITAL_REFERENCE_MISMATCH',
          'Reference pesanan supplier tidak cocok.',
          502
        );
      }

      if(
        snapshot.variant_id!==undefined&&
        String(snapshot.variant_id)!==String(claim.variant_id)
      ){
        throw purchaseError(
          'DWIGITAL_VARIANT_MISMATCH',
          'Varian respons supplier tidak cocok.',
          502
        );
      }

      const saved=await storeSupplierSnapshot(
        orderId,
        snapshot
      );

      return {
        orderId,
        submitted:true,
        supplierStatus:saved?.supplier_status||String(snapshot.status).toLowerCase(),
        refunded:saved?.supplier_refunded===true
      };
    }catch(error){
      await orders.setSubmissionUnknown(
        orderId,
        error?.code||'DWIGITAL_SUBMISSION_UNKNOWN'
      ).catch(()=>{});

      log('warn','dwigital_supplier_submission_unknown',{
        orderId:String(orderId),
        code:String(error?.code||'DWIGITAL_SUBMISSION_UNKNOWN').slice(0,96)
      });

      return {
        orderId,
        submitted:false,
        unknown:true
      };
    }
  }

  async function processSupplierUpdate(event,{eventKey=null}={}){
    if(!event||typeof event!=='object'||Array.isArray(event)){
      throw purchaseError(
        'DWIGITAL_WEBHOOK_INVALID',
        'Payload webhook Dwigital tidak valid.'
      );
    }

    const eventName=String(event.event||'').trim().toLowerCase();

    if(eventName==='webhook.test'){
      return {accepted:true,test:true};
    }

    if(eventName!=='order.updated'){
      return {
        accepted:true,
        ignored:true,
        reason:'UNSUPPORTED_DWIGITAL_EVENT'
      };
    }

    const reference=String(event.reference||'').trim();

    if(
      !reference||
      reference.length>64||
      !/^[A-Za-z0-9._-]+$/.test(reference)
    ){
      throw purchaseError(
        'DWIGITAL_WEBHOOK_REFERENCE_INVALID',
        'Reference webhook Dwigital tidak valid.'
      );
    }

    const existing=await orders.findByReference(reference);

    if(!existing){
      return {
        accepted:true,
        ignored:true,
        reason:'DWIGITAL_ORDER_NOT_FOUND'
      };
    }

    if(
      event.variant_id!==undefined&&
      String(event.variant_id)!==String(existing.variant_id)
    ){
      throw purchaseError(
        'DWIGITAL_WEBHOOK_VARIANT_MISMATCH',
        'Variant webhook tidak cocok dengan pesanan.',
        409
      );
    }

    const saved=await storeSupplierSnapshot(
      existing.order_id,
      event,
      {
        eventKey,
        eventName
      }
    );

    return {
      accepted:true,
      duplicate:saved?.duplicate===true,
      updated:saved?.updated===true,
      supplierStatus:saved?.supplier_status||null
    };
  }

  async function reconcilePending({limit=25}={}){
    const candidates=await orders.listForReconciliation({limit});
    const result={
      scanned:candidates.length,
      submitted:0,
      updated:0,
      stillPending:0,
      errors:0
    };

    for(const candidate of candidates){
      const orderId=candidate.order_id;

      try{
        if(
          candidate.supplier_status==='not_submitted'||
          candidate.submission_state==='unknown'||
          candidate.submission_state==='submitting'
        ){
          const submitted=await fulfillOrder(orderId);

          if(submitted.submitted){
            result.submitted++;
          }else{
            result.stillPending++;
          }

          continue;
        }

        if(
          candidate.supplier_status==='failed'&&
          candidate.supplier_refunded===true
        ){
          await refundService.refundDwigitalOrder(
            orderId,
            'Rekonsiliasi: supplier mengonfirmasi refund pesanan.',
          );

          result.updated++;
          continue;
        }

        const client=clientFactory();

        if(typeof client?.getOrder!=='function'){
          throw purchaseError(
            'DWIGITAL_GET_ORDER_UNAVAILABLE',
            'Pemeriksaan status supplier tidak tersedia.',
            503
          );
        }

        const response=await client.getOrder(
          candidate.supplier_reference
        );

        const snapshot=response?.data&&typeof response.data==='object'
          ? response.data
          : response;

        const saved=await storeSupplierSnapshot(orderId,snapshot);

        if(saved?.updated){
          result.updated++;
        }else{
          result.stillPending++;
        }
      }catch(error){
        result.errors++;

        await orders.markPollError(
          orderId,
          error?.code||'DWIGITAL_RECONCILIATION_FAILED'
        ).catch(()=>{});

        log('warn','dwigital_order_reconciliation_failed',{
          orderId:String(orderId),
          code:String(error?.code||'DWIGITAL_RECONCILIATION_FAILED').slice(0,96)
        });
      }
    }

    return result;
  }

  async function getOrderForUser(orderId,userId){
    const record=await orders.findForOrder(orderId,userId);

    if(!record)return null;

    const {
      target_encrypted:targetEncrypted,
      supplier_note_encrypted:supplierNoteEncrypted,
      supplier_accounts_encrypted:supplierAccountsEncrypted,
      ...safeRecord
    }=record;

    if(!encryptionKey||Buffer.from(encryptionKey,'base64').length!==32){
      throw purchaseError(
        'DWIGITAL_ENCRYPTION_NOT_CONFIGURED',
        'ENCRYPTION_KEY tidak tersedia untuk membaca detail pesanan.',
        503
      );
    }

    let target=null;
    let supplierNote=null;
    let supplierAccounts=null;

    if(targetEncrypted){
      target=JSON.parse(decrypt(targetEncrypted,encryptionKey));
    }

    if(supplierNoteEncrypted){
      supplierNote=decrypt(supplierNoteEncrypted,encryptionKey);
    }

    if(supplierAccountsEncrypted){
      supplierAccounts=JSON.parse(
        decrypt(supplierAccountsEncrypted,encryptionKey)
      );
    }

    return {
      ...safeRecord,
      target,
      supplier_note:supplierNote,
      supplier_accounts:supplierAccounts
    };
  }

  return Object.freeze({
    createOrder,
    fulfillOrder,
    processSupplierUpdate,
    reconcilePending,
    getOrderForUser
  });
}

module.exports={createDwigitalPurchaseService};
