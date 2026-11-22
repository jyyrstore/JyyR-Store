const test=require('node:test');
const assert=require('node:assert/strict');

let dwigital=null;
try{
  dwigital=require('../../src/services/dwigital/dwigital.service');
}catch(error){
  if(error.code!=='MODULE_NOT_FOUND')throw error;
}

let dwigitalCatalogSync=null;
try{
  dwigitalCatalogSync=require('../../src/services/dwigital/catalog.service');
}catch(error){
  if(error.code!=='MODULE_NOT_FOUND')throw error;
}

const EXPECTED_TYPES=['game','sosmed','ppob','digital'];
const API_KEY='dwg_test_unit_only';

function makeClient(options={}){
  assert.equal(
    typeof dwigital?.createDwigitalClient,
    'function',
    'Dwigital service harus menyediakan createDwigitalClient'
  );

  return dwigital.createDwigitalClient({
    apiKey:API_KEY,
    baseUrl:'https://dwigital.id/api/v1',
    ...options
  });
}

function jsonResponse(payload,status=200){
  return {
    ok:status>=200&&status<300,
    status,
    json:async()=>payload
  };
}

test('Dwigital client mendukung empat tipe katalog resmi',()=>{
  assert.deepEqual(dwigital?.PRODUCT_TYPES,EXPECTED_TYPES);
});

test('Dwigital client menolak API key kosong',()=>{
  assert.throws(
    ()=>makeClient({apiKey:''}),
    /DWIGITAL_API_KEY/
  );
});

test('listProducts mengirim filter dan pagination sesuai kontrak API',async()=>{
  const requests=[];
  const product={
    variant_id:1234,
    type:'game',
    price:19850,
    price_unit:'per_order'
  };

  const client=makeClient({
    fetchImpl:async(url,options)=>{
      requests.push({url:String(url),options});
      return jsonResponse({
        success:true,
        data:[product],
        meta:{page:2,last_page:3,per_page:1000}
      });
    }
  });

  const result=await client.listProducts({
    type:'game',
    q:'Mobile Legends',
    page:2,
    perPage:1000
  });

  assert.equal(requests.length,1);

  const request=new URL(requests[0].url);
  assert.equal(request.origin,'https://dwigital.id');
  assert.equal(request.pathname,'/api/v1/products');
  assert.equal(request.searchParams.get('type'),'game');
  assert.equal(request.searchParams.get('q'),'Mobile Legends');
  assert.equal(request.searchParams.get('page'),'2');
  assert.equal(request.searchParams.get('per_page'),'1000');

  const headers=new Headers(requests[0].options.headers);
  assert.equal(headers.get('authorization'),`Bearer ${API_KEY}`);
  assert.equal(headers.get('accept'),'application/json');
  assert.deepEqual(result.data,[product]);
  assert.equal(result.meta.last_page,3);
});

test('listAllProducts mengambil seluruh tipe dan semua halaman',async()=>{
  const requests=[];
  const lastPages={
    game:2,
    sosmed:1,
    ppob:2,
    digital:1
  };
  const typeBase={
    game:100,
    sosmed:200,
    ppob:300,
    digital:400
  };

  const client=makeClient({
    fetchImpl:async(url)=>{
      const parsed=new URL(String(url));
      const type=parsed.searchParams.get('type');
      const page=Number(parsed.searchParams.get('page'));
      const perPage=parsed.searchParams.get('per_page');

      requests.push({type,page,perPage});

      return jsonResponse({
        success:true,
        data:[{
          variant_id:typeBase[type]+page,
          type
        }],
        meta:{
          page,
          last_page:lastPages[type],
          per_page:1000
        }
      });
    }
  });

  const products=await client.listAllProducts();

  assert.deepEqual(
    requests.map(item=>`${item.type}:${item.page}`),
    [
      'game:1',
      'game:2',
      'sosmed:1',
      'ppob:1',
      'ppob:2',
      'digital:1'
    ]
  );

  assert.ok(requests.every(item=>item.perPage==='1000'));

  assert.deepEqual(
    products.map(item=>item.variant_id),
    [101,102,201,301,302,401]
  );
});

test('listProducts menolak tipe katalog di luar kontrak',async()=>{
  const client=makeClient({
    fetchImpl:async()=>{
      throw new Error('Fetch tidak boleh dipanggil');
    }
  });

  await assert.rejects(
    client.listProducts({type:'unknown'}),
    error=>error.code==='INVALID_DWIGITAL_PRODUCT_TYPE'
  );
});

test('getProduct membaca detail satu variant dari endpoint resmi',async()=>{
  const requests=[];
  const product={
    variant_id:1234,
    code:'TEST1234',
    type:'game',
    price:19850,
    price_unit:'per_order'
  };

  const client=makeClient({
    fetchImpl:async(url,options)=>{
      requests.push({url:String(url),options});
      return jsonResponse({
        success:true,
        data:product
      });
    }
  });

  const result=await client.getProduct(1234);

  assert.equal(requests.length,1);
  assert.equal(
    new URL(requests[0].url).pathname,
    '/api/v1/products/1234'
  );
  assert.equal(requests[0].options.method,'GET');
  assert.deepEqual(result,product);
});
// BEGIN JYYR DWIGITAL CATALOG SYNC TESTS
function catalogProduct(overrides={}){
  return {
    variant_id:'501',
    code:'TEST-501',
    product_id:'50',
    type:'game',
    product:'Game Example',
    name:'Package Example',
    price:15000,
    price_unit:'per_order',
    min_qty:null,
    max_qty:null,
    target_label:'User ID',
    zone_required:false,
    zone_label:null,
    extra_field:null,
    nickname_check:false,
    fields:[{
      name:'target',
      label:'User ID',
      required:true,
      example:'12345'
    }],
    delivery:'automatic',
    stock:20,
    note:null,
    ...overrides
  };
}

function getCatalogSync(){
  assert.equal(
    typeof dwigitalCatalogSync?.syncCatalog,
    'function',
    'Dwigital catalog service harus menyediakan syncCatalog'
  );

  return dwigitalCatalogSync.syncCatalog;
}

test('Dwigital catalog sync menyimpan snapshot empat tipe sekaligus',async()=>{
  const products=[
    catalogProduct({variant_id:'GAME-1',type:'game'}),
    catalogProduct({variant_id:'SOCIAL-1',type:'sosmed'}),
    catalogProduct({variant_id:'PPOB-1',type:'ppob'}),
    catalogProduct({variant_id:'DIGITAL-1',type:'digital'})
  ];

  let writeCalls=0;
  let saved=[];

  const result=await getCatalogSync()({
    client:{
      listAllProducts:async()=>products
    },
    repository:{
      replaceSnapshot:async snapshot=>{
        writeCalls++;
        saved=snapshot;
        return {deactivatedCount:2};
      }
    }
  });

  assert.equal(writeCalls,1);
  assert.equal(result.syncedCount,4);
  assert.deepEqual(
    saved.map(item=>item.type),
    ['game','sosmed','ppob','digital']
  );
  assert.deepEqual(
    saved.map(item=>item.variant_id),
    ['GAME-1','SOCIAL-1','PPOB-1','DIGITAL-1']
  );
});

test('Dwigital catalog sync mempertahankan metadata kuantitas sosmed per 1000',async()=>{
  const social=catalogProduct({
    variant_id:'SOCIAL-1000',
    type:'sosmed',
    price:2500,
    price_unit:'per_1000',
    min_qty:100,
    max_qty:50000,
    fields:[{
      name:'target',
      label:'Link tujuan',
      required:true,
      example:'https://example.test/post',
      pattern:'^https://'
    }]
  });

  let saved=[];

  await getCatalogSync()({
    client:{
      listAllProducts:async()=>[social]
    },
    repository:{
      replaceSnapshot:async snapshot=>{
        saved=snapshot;
        return {deactivatedCount:0};
      }
    }
  });

  assert.equal(saved[0].price_unit,'per_1000');
  assert.equal(saved[0].min_qty,100);
  assert.equal(saved[0].max_qty,50000);
  assert.equal(saved[0].fields[0].name,'target');
  assert.equal(saved[0].fields[0].pattern,'^https://');
});

test('Dwigital catalog sync menerima nama dan catatan sepanjang data katalog supplier',async()=>{
  const longName='N'.repeat(260);
  const longNote='D'.repeat(2716);
  let saved=[];

  await getCatalogSync()({
    client:{
      listAllProducts:async()=>[
        catalogProduct({
          variant_id:'LONG-TEXT-1',
          name:longName,
          note:longNote
        })
      ]
    },
    repository:{
      replaceSnapshot:async snapshot=>{
        saved=snapshot;
        return {deactivatedCount:0};
      }
    }
  });

  assert.equal(saved[0].name,longName);
  assert.equal(saved[0].note,longNote);
});

test('Dwigital catalog sync menormalkan karakter backspace pada catatan',async()=>{
  let saved=[];

  await getCatalogSync()({
    client:{
      listAllProducts:async()=>[
        catalogProduct({
          variant_id:'CONTROL-NOTE-1',
          note:'Sebelum\u0008Sesudah'
        })
      ]
    },
    repository:{
      replaceSnapshot:async snapshot=>{
        saved=snapshot;
        return {deactivatedCount:0};
      }
    }
  });

  assert.equal(saved[0].note,'Sebelum Sesudah');
});

test('Dwigital catalog sync mempertahankan batas kuantitas terbalik dan menandainya tidak valid',async()=>{
  let saved=[];

  await getCatalogSync()({
    client:{
      listAllProducts:async()=>[
        catalogProduct({
          variant_id:'SOCIAL-INVALID-BOUNDS',
          type:'sosmed',
          price_unit:'per_1000',
          min_qty:10000,
          max_qty:1
        })
      ]
    },
    repository:{
      replaceSnapshot:async snapshot=>{
        saved=snapshot;
        return {deactivatedCount:0};
      }
    }
  });

  assert.equal(saved[0].min_qty,10000);
  assert.equal(saved[0].max_qty,1);
  assert.equal(saved[0].quantity_bounds_valid,false);
});

test('Dwigital catalog sync menolak data tidak valid sebelum menulis snapshot',async()=>{
  let writeCalls=0;

  await assert.rejects(
    getCatalogSync()({
      client:{
        listAllProducts:async()=>[
          catalogProduct({price:-1})
        ]
      },
      repository:{
        replaceSnapshot:async()=>{
          writeCalls++;
        }
      }
    }),
    error=>error.code==='INVALID_DWIGITAL_CATALOG_PRODUCT'
  );

  assert.equal(writeCalls,0);
});

test('Dwigital catalog sync tidak menulis snapshot jika pengambilan katalog gagal',async()=>{
  let writeCalls=0;

  await assert.rejects(
    getCatalogSync()({
      client:{
        listAllProducts:async()=>{
          throw new Error('Dwigital API unavailable');
        }
      },
      repository:{
        replaceSnapshot:async()=>{
          writeCalls++;
        }
      }
    }),
    /Dwigital API unavailable/
  );

  assert.equal(writeCalls,0);
});

test('Dwigital catalog sync menolak duplikasi variant ID sebelum persistensi',async()=>{
  let writeCalls=0;

  await assert.rejects(
    getCatalogSync()({
      client:{
        listAllProducts:async()=>[
          catalogProduct({variant_id:'DUPLICATE-1',type:'game'}),
          catalogProduct({variant_id:'DUPLICATE-1',type:'digital'})
        ]
      },
      repository:{
        replaceSnapshot:async()=>{
          writeCalls++;
        }
      }
    }),
    error=>error.code==='DUPLICATE_DWIGITAL_VARIANT_ID'
  );

  assert.equal(writeCalls,0);
});

test('Dwigital catalog repository menyimpan snapshot secara atomik',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const root=path.resolve(__dirname,'../..');
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');

  const migrationPath='database/migrations/048_dwigital_catalog.sql';
  const repositoryPath='src/repositories/dwigital-catalog.repository.js';

  assert.equal(
    fs.existsSync(path.join(root,migrationPath)),
    true,
    'Migrasi dwigital_catalog harus tersedia'
  );

  assert.equal(
    fs.existsSync(path.join(root,repositoryPath)),
    true,
    'Repository Dwigital harus tersedia'
  );

  const migration=read(migrationPath);
  const repository=read(repositoryPath);

  assert.match(
    migration,
    /create table if not exists dwigital_catalog/i
  );

  assert.match(
    migration,
    /variant_id\s+text\s+primary key/i
  );

  assert.match(
    migration,
    /type\s+text\s+not null/i
  );

  assert.match(
    migration,
    /payload\s+jsonb\s+not null/i
  );

  assert.match(
    migration,
    /is_active\s+boolean\s+not null/i
  );

  assert.match(
    migration,
    /alter table\s+(?:public\.)?dwigital_catalog\s+enable row level security/i
  );

  assert.match(
    repository,
    /async function replaceSnapshot\(products\)/
  );

  assert.match(
    repository,
    /withTransaction\s*\(\s*async\s*\(\s*client\s*\)\s*=>/
  );

  assert.match(
    repository,
    /pg_advisory_xact_lock/
  );

  assert.match(
    repository,
    /insert into dwigital_catalog/i
  );

  assert.match(
    repository,
    /on conflict\s*\(\s*variant_id\s*\)\s*do update/i
  );

  assert.match(
    repository,
    /update dwigital_catalog[\s\S]*?set\s+is_active=false/i
  );

  assert.match(
    repository,
    /deactivatedCount/
  );

  assert.match(
    repository,
    /INVALID_DWIGITAL_CATALOG_SNAPSHOT/
  );

  assert.match(
    repository,
    /DUPLICATE_DWIGITAL_VARIANT_ID/
  );

  assert.match(
    repository,
    /module\.exports\s*=\s*\{\s*replaceSnapshot\s*,\s*claimSync\s*,\s*completeSync\s*,\s*failSync\s*\}/
  );
});

test('Dwigital catalog repository menolak snapshot kosong dan variant duplikat',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const root=path.resolve(__dirname,'../..');

  const repository=fs.readFileSync(
    path.join(root,'src/repositories/dwigital-catalog.repository.js'),
    'utf8'
  );

  assert.match(
    repository,
    /products\.length\s*===\s*0/
  );

  assert.match(
    repository,
    /new Set/
  );

  assert.match(
    repository,
    /DUPLICATE_DWIGITAL_VARIANT_ID/
  );

  assert.match(
    repository,
    /INVALID_DWIGITAL_CATALOG_SNAPSHOT/
  );
});

test('Dwigital catalog tercatat pada seluruh kontrak verifikasi database',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const root=path.resolve(__dirname,'../..');

  for(const file of [
    'scripts/verify-database.js',
    'scripts/verify-project.js',
    'tests/integration/contract.test.js'
  ]){
    const source=fs.readFileSync(
      path.join(root,file),
      'utf8'
    );

    assert.match(
      source,
      /['"]dwigital_catalog['"]/,
      `${file} harus memverifikasi dwigital_catalog`
    );
  }
});


test('Dwigital sync job dinonaktifkan tanpa API key',async()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const jobPath=path.resolve(
    __dirname,
    '../../src/jobs/dwigital-catalog-sync.job.js'
  );

  assert.equal(fs.existsSync(jobPath),true,'Dwigital sync job harus tersedia');

  const {runDwigitalCatalogSync}=require(jobPath);
  let claimCalls=0;

  const result=await runDwigitalCatalogSync({
    env:{DWIGITAL_API_KEY:''},
    repository:{
      claimSync:async()=>{claimCalls++;return {acquired:true};}
    },
    clientFactory:()=>{throw new Error('Supplier tidak boleh dipanggil');}
  });

  assert.equal(result.status,'disabled');
  assert.equal(claimCalls,0);
});

test('Dwigital sync job melewati jadwal yang belum jatuh tempo',async()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const jobPath=path.resolve(
    __dirname,
    '../../src/jobs/dwigital-catalog-sync.job.js'
  );

  assert.equal(fs.existsSync(jobPath),true,'Dwigital sync job harus tersedia');

  const {runDwigitalCatalogSync}=require(jobPath);
  let clientCalls=0;
  let syncCalls=0;

  const result=await runDwigitalCatalogSync({
    env:{
      DWIGITAL_API_KEY:'dwg_test_unit',
      DWIGITAL_API_BASE_URL:'https://dwigital.id/api/v1',
      DWIGITAL_SYNC_INTERVAL_MINUTES:360
    },
    repository:{
      claimSync:async()=>({acquired:false})
    },
    clientFactory:()=>{clientCalls++;return {};},
    syncCatalog:async()=>{syncCalls++;return {syncedCount:1};}
  });

  assert.equal(result.status,'skipped');
  assert.equal(clientCalls,0);
  assert.equal(syncCalls,0);
});

test('Dwigital sync job menyelesaikan lease setelah sinkronisasi berhasil',async()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const jobPath=path.resolve(
    __dirname,
    '../../src/jobs/dwigital-catalog-sync.job.js'
  );

  assert.equal(fs.existsSync(jobPath),true,'Dwigital sync job harus tersedia');

  const {runDwigitalCatalogSync}=require(jobPath);
  const calls={claim:0,complete:0,fail:0,sync:0};
  let claimedToken=null;
  let clientCreated=false;

  const repository={
    claimSync:async options=>{
      calls.claim++;
      claimedToken=options.leaseToken;
      assert.equal(typeof claimedToken,'string');
      return {acquired:true};
    },
    completeSync:async options=>{
      calls.complete++;
      assert.equal(options.leaseToken,claimedToken);
      assert.equal(options.intervalMinutes,360);
    },
    failSync:async()=>{
      calls.fail++;
    }
  };

  const result=await runDwigitalCatalogSync({
    env:{
      DWIGITAL_API_KEY:'dwg_test_unit',
      DWIGITAL_API_BASE_URL:'https://dwigital.id/api/v1',
      DWIGITAL_SYNC_INTERVAL_MINUTES:360
    },
    repository,
    clientFactory:()=>{clientCreated=true;return {client:true};},
    syncCatalog:async({client,repository:catalogRepository})=>{
      calls.sync++;
      assert.deepEqual(client,{client:true});
      assert.equal(catalogRepository,repository);
      return {syncedCount:4,deactivatedCount:2};
    }
  });

  assert.equal(clientCreated,true);
  assert.deepEqual(calls,{claim:1,complete:1,fail:0,sync:1});
  assert.equal(result.status,'synced');
  assert.equal(result.syncedCount,4);
  assert.equal(result.deactivatedCount,2);
});

test('Dwigital sync job menjadwalkan retry ketika supplier gagal',async()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const jobPath=path.resolve(
    __dirname,
    '../../src/jobs/dwigital-catalog-sync.job.js'
  );

  assert.equal(fs.existsSync(jobPath),true,'Dwigital sync job harus tersedia');

  const {runDwigitalCatalogSync}=require(jobPath);
  const failure=Object.assign(
    new Error('supplier internal failure'),
    {code:'DWIGITAL_API_UNAVAILABLE'}
  );
  let claimedToken=null;
  let failedOptions=null;

  const repository={
    claimSync:async options=>{
      claimedToken=options.leaseToken;
      return {acquired:true};
    },
    completeSync:async()=>{
      throw new Error('completeSync tidak boleh dipanggil');
    },
    failSync:async options=>{
      failedOptions=options;
    }
  };

  await assert.rejects(
    runDwigitalCatalogSync({
      env:{
        DWIGITAL_API_KEY:'dwg_test_unit',
        DWIGITAL_API_BASE_URL:'https://dwigital.id/api/v1',
        DWIGITAL_SYNC_INTERVAL_MINUTES:360
      },
      repository,
      clientFactory:()=>({}),
      syncCatalog:async()=>{throw failure;}
    }),
    error=>error===failure
  );

  assert.equal(failedOptions.leaseToken,claimedToken);
  assert.equal(failedOptions.errorCode,'DWIGITAL_API_UNAVAILABLE');
  assert.equal(failedOptions.retryMinutes,15);
});

test('Dwigital sync scheduler memakai cron terlindungi dan state database',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const root=path.resolve(__dirname,'../..');
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');

  const migrationPath='database/migrations/049_dwigital_catalog_sync_state.sql';
  const repositoryPath='src/repositories/dwigital-catalog.repository.js';

  assert.equal(
    fs.existsSync(path.join(root,migrationPath)),
    true,
    'Migrasi scheduler Dwigital harus tersedia'
  );

  const migration=read(migrationPath);
  const repository=read(repositoryPath);
  const env=read('src/config/env.js');
  const envExample=read('.env.example');
  const controller=read('src/controllers/cron.controller.js');
  const routes=read('src/routes/index.js');

  assert.match(
    migration,
    /create table if not exists dwigital_catalog_sync_state/i
  );
  assert.match(migration,/lease_token\s+uuid/i);
  assert.match(migration,/lease_expires_at\s+timestamptz/i);
  assert.match(migration,/next_sync_at\s+timestamptz/i);
  assert.match(
    migration,
    /alter table\s+(?:public\.)?dwigital_catalog_sync_state\s+enable row level security/i
  );

  for(const method of ['claimSync','completeSync','failSync']){
    assert.match(
      repository,
      new RegExp(`async function ${method}\\(`),
      `${method} harus tersedia di repository canonical`
    );
  }

  assert.match(env,/DWIGITAL_API_KEY:\s*process\.env\.DWIGITAL_API_KEY/);
  assert.match(env,/DWIGITAL_API_BASE_URL:/);
  assert.match(env,/DWIGITAL_SYNC_INTERVAL_MINUTES:/);

  assert.match(envExample,/^DWIGITAL_API_KEY=/m);
  assert.match(envExample,/^DWIGITAL_API_BASE_URL=/m);
  assert.match(envExample,/^DWIGITAL_SYNC_INTERVAL_MINUTES=/m);

  assert.match(
    controller,
    /runDwigitalCatalogSync/
  );
  assert.match(controller,/dwigitalCatalog/);

  assert.match(
    routes,
    /cronRouter\.get\('\/expire',cron\.requireCronSecret,asyncHandler\(cron\.expire\)\)/
  );

  for(const file of [
    'scripts/verify-database.js',
    'scripts/verify-project.js',
    'tests/integration/contract.test.js'
  ]){
    assert.match(
      read(file),
      /['"]dwigital_catalog_sync_state['"]/,
      `${file} harus memverifikasi tabel scheduler`
    );
  }
});

// END JYYR DWIGITAL CATALOG SYNC TESTS
