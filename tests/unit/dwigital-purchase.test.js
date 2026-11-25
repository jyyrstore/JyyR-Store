const test=require('node:test');
const assert=require('node:assert/strict');

let createDwigitalPurchaseService=null;
let loadError=null;

try{
  ({createDwigitalPurchaseService}=require(
    '../../src/services/dwigital/purchase.service'
  ));
}catch(error){
  loadError=error;
}

const ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');

const fields=[
  {
    name:'target',
    required:true,
    pattern:'^[A-Za-z0-9#._\\-]{2,64}$'
  },
  {
    name:'target_zone',
    required:true,
    pattern:'^[A-Za-z0-9._\\-]{1,32}$'
  }
];

function makeHarness(options={}){
  const calls={
    display:[],
    supplier:[],
    purchase:[]
  };

  const variant={
    variant_id:'1234',
    source_name:'86 Diamonds',
    display_name:'86 Diamonds',
    retail_price:23000,
    base_price:19000,
    delivery:'automatic',
    fields,
    target_label:'User ID',
    zone_required:true,
    zone_label:'Zone ID',
    extra_field:null,
    is_visible:true,
    ...options.variant
  };

  const displayProduct={
    provider_type:'game',
    provider_product_id:'12',
    display_name:'Mobile Legends',
    variants:[variant]
  };

  const supplierProduct={
    variant_id:1234,
    type:'game',
    product_id:12,
    name:'86 Diamonds',
    price:19850,
    delivery:'automatic',
    stock:null,
    fields,
    target_label:'User ID',
    zone_required:true,
    extra_field:null,
    ...options.supplierProduct
  };

  const repository={
    createPurchase:async input=>{
      calls.purchase.push(input);
      return {
        order:{
          id:'order-test-1',
          order_number:'JYR-20261124-ABC123',
          status:input.paymentMethod==='BALANCE'?'PAID':'PENDING',
          payment_method:input.paymentMethod
        },
        duplicate:false
      };
    }
  };

  const service=typeof createDwigitalPurchaseService==='function'
    ? createDwigitalPurchaseService({
        env:{
          DWIGITAL_API_KEY:'dwg_test_unit',
          DWIGITAL_API_BASE_URL:'https://dwigital.id/api/v1',
          ENCRYPTION_KEY:options.encryptionKey===undefined
            ? ENCRYPTION_KEY
            : options.encryptionKey
        },
        clientFactory:()=>({
          getProduct:async variantId=>{
            calls.supplier.push(variantId);
            return supplierProduct;
          }
        }),
        displayRepository:{
          findProviderProduct:async(type,productId,settings)=>{
            calls.display.push({type,productId,settings});
            return displayProduct;
          }
        },
        repository,
        generateOrderNumber:()=> 'JYR-20261124-ABC123'
      })
    : null;

  return {service,calls};
}

const validInput={
  userId:'00000000-0000-4000-8000-000000000001',
  idempotencyKey:'dwigital-purchase-test-001',
  type:'game',
  productId:'12',
  variantId:'1234',
  target:'123456789',
  targetZone:'2345',
  paymentMethod:'GATEWAY'
};

function assertFactory(t){
  assert.equal(
    typeof createDwigitalPurchaseService,
    'function',
    'purchase service harus menyediakan createDwigitalPurchaseService'
      +(loadError?`: ${loadError.message}`:'')
  );

  return typeof createDwigitalPurchaseService==='function';
}

test('Dwigital purchase memverifikasi harga supplier terbaru dan menyimpan target terenkripsi',async()=>{
  if(!assertFactory())return;

  const {service,calls}=makeHarness();
  const result=await service.createOrder(validInput);

  assert.equal(result.order.id,'order-test-1');
  assert.deepEqual(calls.supplier,['1234']);
  assert.deepEqual(calls.display[0],{
    type:'game',
    productId:'12',
    settings:{publicOnly:true}
  });

  assert.equal(calls.purchase.length,1);

  const saved=calls.purchase[0];
  assert.equal(saved.paymentMethod,'GATEWAY');
  assert.equal(saved.retailPrice,23000);
  assert.equal(saved.supplierPrice,19850);
  assert.equal(saved.maxPrice,19850);
  assert.equal(saved.supplierReference,'JYR-20261124-ABC123');

  assert.equal(typeof saved.targetEncrypted,'string');
  assert.notEqual(saved.targetEncrypted,validInput.target);
  assert.equal(saved.target,undefined);
  assert.equal(saved.targetZone,undefined);
});

test('Dwigital purchase menolak harga modal terbaru yang melebihi harga jual',async()=>{
  if(!assertFactory())return;

  const {service,calls}=makeHarness({
    variant:{retail_price:19000}
  });

  await assert.rejects(
    service.createOrder(validInput),
    error=>error.code==='DWIGITAL_RETAIL_PRICE_BELOW_COST'
  );

  assert.equal(calls.purchase.length,0);
});

test('Dwigital purchase menolak varian yang tidak terlihat secara publik',async()=>{
  if(!assertFactory())return;

  const {service,calls}=makeHarness({
    variant:{is_visible:false}
  });

  await assert.rejects(
    service.createOrder(validInput),
    error=>error.code==='DWIGITAL_VARIANT_UNAVAILABLE'
  );

  assert.equal(calls.supplier.length,0);
  assert.equal(calls.purchase.length,0);
});

test('Dwigital purchase menolak penyimpanan target tanpa encryption key',async()=>{
  if(!assertFactory())return;

  const {service,calls}=makeHarness({encryptionKey:''});

  await assert.rejects(
    service.createOrder(validInput),
    error=>error.code==='DWIGITAL_ENCRYPTION_NOT_CONFIGURED'
  );

  assert.equal(calls.purchase.length,0);
});

test('Dwigital purchase menolak extra_field yang format payload-nya belum terverifikasi',async()=>{
  if(!assertFactory())return;

  const {service,calls}=makeHarness({
    variant:{extra_field:'server'},
    supplierProduct:{extra_field:'server'}
  });

  await assert.rejects(
    service.createOrder(validInput),
    error=>error.code==='DWIGITAL_EXTRA_FIELD_UNSUPPORTED'
  );

  assert.equal(calls.purchase.length,0);
});


// BEGIN JYYR DWIGITAL FULFILLMENT TESTS
function buildJYYRDwigitalFulfillmentHarness(options={}){
  const {encrypt}=require('../../src/utils/crypto');
  const {createDwigitalPurchaseService}=require('../../src/services/dwigital/purchase.service');
  const secret=Buffer.alloc(32,7).toString('base64');
  const orderId='00000000-0000-4000-8000-000000000001';
  const reference='JYR-20261124-ABC123';
  const calls={
    payload:null,
    snapshots:[],
    unknown:[],
    rejected:[],
    refunds:[],
    polled:[],
    snapshotOptions:[]
  };

  const targetEncrypted=encrypt(
    JSON.stringify({
      target:'123456789',
      targetZone:'2345'
    }),
    secret
  );

  const repository={
    claimForSubmission:async()=>{
      if(options.unclaimed){
        return {claimed:false,order_id:orderId};
      }

      return {
        claimed:true,
        order_id:orderId,
        user_id:'00000000-0000-4000-8000-000000000002',
        order_number:reference,
        order_status:'PAID',
        payment_method:'BALANCE',
        supplier_reference:reference,
        variant_id:'1234',
        target_encrypted:targetEncrypted,
        max_price:19850,
        supplier_status:'not_submitted',
        submission_state:'submitting'
      };
    },
    setSubmissionUnknown:async(id,code)=>{
      calls.unknown.push({id,code});
      return true;
    },
    setSubmissionRejected:async(id,code)=>{
      calls.rejected.push({id,code});
      return true;
    },
    findByReference:async()=>({
      order_id:orderId,
      supplier_reference:reference,
      variant_id:'1234'
    }),
    applySupplierSnapshot:async(id,snapshot,applyOptions={})=>{
      calls.snapshots.push(snapshot);
      calls.snapshotOptions.push(applyOptions);

      if(snapshot.status==='failed'&&snapshot.refunded===true){
        await applyOptions.onRefund(
          {},
          {
            order:{id:orderId},
            dwigital:{
              supplier_status:'failed',
              supplier_refunded:true
            }
          }
        );
      }

      return {
        duplicate:false,
        updated:true,
        order_id:id,
        supplier_status:snapshot.status
      };
    },
    listForReconciliation:async()=>options.candidates||[],
    markPollError:async(id,code)=>{
      calls.unknown.push({id,code});
    }
  };

  const client={
    createOrder:async payload=>{
      calls.payload=payload;

      if(options.createError){
        throw options.createError;
      }

      return options.createResponse||{
        ref_id:'DW-UNIT-001',
        reference,
        status:'processing',
        refunded:false,
        variant_id:1234,
        delivery:'automatic'
      };
    },
    getOrder:async referenceValue=>{
      calls.polled.push(referenceValue);

      if(options.getOrderError){
        throw options.getOrderError;
      }

      return options.getOrderResponse||{
        ref_id:'DW-UNIT-001',
        reference:referenceValue,
        status:'processing',
        refunded:false,
        variant_id:1234,
        delivery:'automatic'
      };
    },
    getProduct:async()=>({variant_id:1234,price:19850})
  };

  const refundService={
    refundDwigitalOrder:async(...args)=>{
      calls.refunds.push(args);
      return {id:'refund-unit-001'};
    }
  };

  const service=createDwigitalPurchaseService({
    env:{ENCRYPTION_KEY:secret},
    clientFactory:()=>client,
    repository,
    displayRepository:{},
    refundService
  });

  return {service,calls,orderId,reference,secret};
}

test('Dwigital fulfillment mengirim reference, target terdekripsi, dan max_price',async()=>{
  const harness=buildJYYRDwigitalFulfillmentHarness();

  const result=await harness.service.fulfillOrder(harness.orderId);

  assert.equal(result.submitted,true);
  assert.equal(harness.calls.payload.reference,harness.reference);
  assert.equal(harness.calls.payload.variant_id,1234);
  assert.equal(harness.calls.payload.target,'123456789');
  assert.equal(harness.calls.payload.target_zone,'2345');
  assert.equal(harness.calls.payload.max_price,19850);
  assert.equal(harness.calls.snapshots[0].status,'processing');
  assert.equal(
    Object.prototype.hasOwnProperty.call(harness.calls.payload,'target_encrypted'),
    false
  );
});

test('Dwigital fulfillment menandai hasil network tidak pasti tanpa refund otomatis',async()=>{
  const harness=buildJYYRDwigitalFulfillmentHarness({
    createError:Object.assign(
      new Error('request timeout'),
      {code:'DWIGITAL_TIMEOUT'}
    )
  });

  const result=await harness.service.fulfillOrder(harness.orderId);

  assert.equal(result.unknown,true);
  assert.equal(harness.calls.unknown.length,1);
  assert.equal(harness.calls.unknown[0].code,'DWIGITAL_TIMEOUT');
  assert.equal(harness.calls.refunds.length,0);
});


test('Dwigital fulfillment terminally refunds a permanent supplier rejection',async()=>{
  const harness=buildJYYRDwigitalFulfillmentHarness({
    createError:Object.assign(
      new Error('Target tidak valid.'),
      {
        code:'DWIGITAL_API_ERROR',
        providerStatus:422,
        providerCode:'invalid_target',
        permanentRejection:true
      }
    )
  });

  const result=await harness.service.fulfillOrder(harness.orderId);

  assert.equal(result.submitted,false);
  assert.equal(result.rejected,true);
  assert.equal(result.refunded,true);
  assert.equal(result.code,'invalid_target');
  assert.equal(harness.calls.rejected.length,1);
  assert.equal(harness.calls.unknown.length,0);
  assert.equal(harness.calls.refunds.length,1);
});

test('Dwigital reconciliation refunds a persisted rejected submission',async()=>{
  const harness=buildJYYRDwigitalFulfillmentHarness({
    candidates:[{
      order_id:'00000000-0000-4000-8000-000000000001',
      supplier_reference:'JYR-20261124-ABC123',
      supplier_status:'failed',
      supplier_refunded:false,
      submission_state:'rejected'
    }]
  });

  const result=await harness.service.reconcilePending({limit:10});

  assert.equal(result.scanned,1);
  assert.equal(result.updated,1);
  assert.equal(harness.calls.refunds.length,1);
  assert.equal(harness.calls.polled.length,0);
  assert.equal(harness.calls.snapshots.length,0);
});

test('Dwigital gagal baru memanggil refund jika supplier refunded true',async()=>{
  const harness=buildJYYRDwigitalFulfillmentHarness({
    createResponse:{
      ref_id:'DW-UNIT-FAILED',
      reference:'JYR-20261124-ABC123',
      status:'failed',
      refunded:true,
      variant_id:1234
    }
  });

  await harness.service.fulfillOrder(harness.orderId);

  assert.equal(harness.calls.refunds.length,1);
  assert.equal(harness.calls.refunds[0][0],harness.orderId);
});

test('Dwigital webhook hanya memproses order.updated dengan reference yang dikenal',async()=>{
  const harness=buildJYYRDwigitalFulfillmentHarness();

  const result=await harness.service.processSupplierUpdate({
    event:'order.updated',
    reference:harness.reference,
    ref_id:'DW-WEBHOOK-001',
    variant_id:1234,
    status:'success',
    refunded:false,
    note:'SN-TEST',
    accounts:null
  },{
    eventKey:'a'.repeat(64)
  });

  assert.equal(result.updated,true);
  assert.equal(harness.calls.snapshots.length,1);
  assert.equal(
    harness.calls.snapshotOptions[0].eventKey,
    'a'.repeat(64)
  );
});

test('Dwigital reconciliation memeriksa ulang pesanan supplier yang submitted',async()=>{
  const harness=buildJYYRDwigitalFulfillmentHarness({
    candidates:[{
      order_id:'00000000-0000-4000-8000-000000000001',
      supplier_reference:'JYR-20261124-ABC123',
      supplier_status:'processing',
      submission_state:'submitted'
    }]
  });

  const result=await harness.service.reconcilePending({limit:10});

  assert.equal(result.scanned,1);
  assert.equal(harness.calls.polled[0],harness.reference);
  assert.equal(harness.calls.snapshots.length,1);
});
// END JYYR DWIGITAL FULFILLMENT TESTS

// BEGIN JYYR DWIGITAL ROUTE INTEGRATION TESTS
test('Dwigital order endpoint is authenticated, validated, and rate limited',()=>{
  const fs=require('node:fs');
  const routes=fs.readFileSync(
    require('node:path').join(process.cwd(),'src/routes/index.js'),
    'utf8'
  );

  assert.match(
    routes,
    /apiRouter\.post\(['"]\/dwigital\/orders['"],\s*requireAuth,\s*sensitiveRateLimit\(\),\s*validate\(dwigitalOrderSchema\)/s
  );
  const schemaDeclaration=routes.indexOf('const dwigitalOrderSchema');
  const routeRegistration=routes.indexOf("apiRouter.post('/dwigital/orders'");
  assert.ok(
    schemaDeclaration>=0 &&
    routeRegistration>=0 &&
    schemaDeclaration<routeRegistration,
    'schema declaration must precede route registration'
  );
  assert.match(routes,/paymentMethod:z\.enum\(\['BALANCE','GATEWAY'\]\)/);
  assert.match(routes,/targetZone:z\.string\(\)/);
  assert.match(routes,/api\.dwigitalOrderController\.create/);
});

test('Dwigital webhook is raw-body HMAC protected and mounted before JSON parsing',()=>{
  const fs=require('node:fs');
  const routes=fs.readFileSync(
    require('node:path').join(process.cwd(),'src/routes/index.js'),
    'utf8'
  );
  const server=fs.readFileSync(
    require('node:path').join(process.cwd(),'server.js'),
    'utf8'
  );

  assert.match(routes,/function createDwigitalWebhookRouter\(\)/);
  assert.match(routes,/express\.raw\(\{type:'application\/json',limit:'1mb'\}\)/);
  assert.match(routes,/createHmac\(['"]sha256['"]/);
  assert.match(routes,/timingSafeEqual/);
  assert.match(routes,/processSupplierUpdate/);

  const mount=server.indexOf("app.use('/api/webhook/dwigital'");
  const parser=server.indexOf("app.use(express.json");

  assert.ok(mount>=0&&parser>mount);
});

test('Dwigital payment webhook preserves local cart and starts fulfillment after commit',()=>{
  const fs=require('node:fs');
  const payment=fs.readFileSync(
    require('node:path').join(process.cwd(),'src/services/payment/payment.service.js'),
    'utf8'
  );

  assert.match(payment,/const isDwigitalOrder\s*=\s*Boolean/);
  assert.match(payment,/if\(!isDwigitalOrder\)\s*\{\s*await carts\.clear/);
  assert.match(payment,/title:'Pesanan sedang diproses'/);
  assert.match(payment,/createDwigitalPurchaseService/);
  assert.match(payment,/fulfillOrder\(result\.orderId\)/);
  assert.match(payment,/isDwigitalOrder\s*&&\s*current==='PAID'/);
});

test('Dwigital API detail avoids returning encrypted persistence fields',()=>{
  const fs=require('node:fs');
  const api=fs.readFileSync(
    require('node:path').join(process.cwd(),'src/controllers/api.controller.js'),
    'utf8'
  );

  assert.match(api,/const dwigitalOrderController=/);
  assert.match(api,/getOrderForUser/);
  assert.match(api,/dwigitalOrderController/);
});

test('Dwigital order reconciliation is included in the protected cron job',()=>{
  const fs=require('node:fs');
  const cron=fs.readFileSync(
    require('node:path').join(process.cwd(),'src/controllers/cron.controller.js'),
    'utf8'
  );

  assert.match(cron,/createDwigitalPurchaseService/);
  assert.match(cron,/reconcilePending\(\{limit:25\}\)/);
  assert.match(cron,/dwigitalOrders/);
});
// END JYYR DWIGITAL ROUTE INTEGRATION TESTS
