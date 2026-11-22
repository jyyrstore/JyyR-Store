const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');

function read(relative){
  return fs.readFileSync(path.join(root,relative),'utf8');
}

test('store renders provider catalog separately using existing service cards',()=>{
  const controller=read('src/controllers/page.controller.js');
  const view=read('views/pages/store.ejs');

  assert.match(controller,/listPublicCatalog/);
  assert.match(view,/providerCatalog/);
  assert.match(view,/class="service-grid"/);
  assert.match(view,/class="service-card"/);
});

test('Owner provider-products page uses existing protected owner routing',()=>{
  const routes=read('src/routes/index.js');
  const sidebar=read('views/partials/sidebar.ejs');
  const view=read('views/owner/index.ejs');

  assert.match(routes,/provider-products/);
  assert.match(sidebar,/Produk Provider/);
  assert.match(view,/data-provider-product-form/);
  assert.match(view,/data-owner-provider-category-edit/);
  assert.match(view,/data-provider-base-price/);
  assert.match(view,/data-provider-margin/);
});

test('provider editor reuses signed upload helper and calculates live margin',()=>{
  const pages=read('public/js/pages.js');

  assert.match(pages,/endpointBase/);
  assert.match(pages,/data-provider-product-form/);
  assert.match(pages,/data-provider-category-form/);
  assert.match(pages,/data-provider-variant-price/);
});

test('Owner provider-product listing initializes an empty editor local',()=>{
  const controller=read('src/controllers/page.controller.js');

  const start=controller.indexOf("else if(section==='provider-products'){");
  const end=controller.indexOf("else if(section==='products'){",start);

  assert.ok(start>=0 && end>start,'provider-products controller branch exists');

  const branch=controller.slice(start,end);
  const emptyLocal=branch.indexOf('data.providerProduct=null;');
  const editorCondition=branch.indexOf('if(productId){');

  assert.ok(emptyLocal>=0,'providerProduct has a null default for listing mode');
  assert.ok(editorCondition>=0,'editor lookup remains conditional on productId');
  assert.ok(
    emptyLocal<editorCondition,
    'default editor local is assigned before optional editor lookup'
  );
});
