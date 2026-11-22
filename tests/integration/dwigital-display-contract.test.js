const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');
const routes=fs.readFileSync(path.join(root,'src/routes/index.js'),'utf8');
const api=fs.readFileSync(path.join(root,'src/controllers/api.controller.js'),'utf8');

test('Dwigital Owner endpoints remain protected by the canonical owner router',()=>{
  assert.match(
    routes,
    /const ownerApi=express\.Router\(\); ownerApi\.use\(requireAuth,requireOwner\)/
  );

  for(const route of [
    "ownerApi.put(\n  '/provider-products/categories/:categoryKey'",
    "ownerApi.put(\n  '/provider-products/:type/:productId'",
    "ownerApi.post(\n  '/provider-products/:type/:productId/upload-init'",
    "ownerApi.post(\n  '/provider-products/:type/:productId/upload-complete'"
  ]){
    assert.ok(routes.includes(route),`Route tidak ditemukan: ${route}`);
  }

  assert.ok(
    routes.indexOf("'/provider-products/categories/:categoryKey'") <
    routes.indexOf("'/provider-products/:type/:productId'"),
    'Route kategori statis harus dideklarasikan sebelum route produk dinamis.'
  );
});

test('Dwigital media upload validates ownership, file contents, and Storage metadata',()=>{
  assert.match(api,/async function ownerProviderUploadInit/);
  assert.match(api,/async function ownerProviderUploadComplete/);
  assert.match(api,/validateUploadedObject\(\{/);
  assert.match(api,/storage\.fileExists\(bucket,path\)/);
  assert.match(api,/storage\.fileInfo\(bucket,path\)/);
  assert.match(api,/dwigital\/\$\{type\}\/\$\{productId\}\//);
  assert.match(api,/repo\.isMediaReferenced\(previousPath\)/);
});

test('Dwigital external identifiers are kept in audit metadata, not UUID entity_id',()=>{
  const productStart=api.indexOf('providerProductSave:async(req,res)=>{');
  const categoryStart=api.indexOf('providerCategorySave:async(req,res)=>{',productStart);
  const productsStart=api.indexOf('products:async(req,res)=>',categoryStart);

  assert.ok(
    productStart>=0 && categoryStart>productStart && productsStart>categoryStart,
    'Implementasi save produk dan kategori Dwigital harus ditemukan.'
  );

  const productSave=api.slice(productStart,categoryStart);
  const categorySave=api.slice(categoryStart,productsStart);

  assert.match(productSave,/entityId:null/);
  assert.match(productSave,/providerProductId:req\.params\.productId/);
  assert.doesNotMatch(productSave,/entityId:req\.params\.productId/);

  assert.match(categorySave,/entityId:null/);
  assert.match(categorySave,/categoryKey:req\.params\.categoryKey/);
  assert.doesNotMatch(categorySave,/entityId:req\.params\.categoryKey/);

  const uploadStart=api.indexOf("action:contentType==='THUMBNAIL'");
  const uploadEnd=api.indexOf(
    'return ok(res,{path,contentType,variantId});',
    uploadStart
  );

  assert.ok(uploadStart>=0 && uploadEnd>uploadStart,'Audit upload Dwigital harus ditemukan.');

  const uploadAudit=api.slice(uploadStart,uploadEnd);

  assert.match(uploadAudit,/entityId:null/);
  assert.match(
    uploadAudit,
    /metadata:\{type,productId,variantId,path,size:fileSize,mimeType:descriptor\.mime\}/
  );
  assert.doesNotMatch(uploadAudit,/entityId:variantId\|\|productId/);
});
