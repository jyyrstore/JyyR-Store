const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');

function read(relative){
  return fs.readFileSync(path.join(root,relative),'utf8');
}

test('Dwigital card opens detail page with public variants and retail prices',()=>{
  const controller=read('src/controllers/page.controller.js');
  const routes=read('src/routes/index.js');
  const repository=read('src/repositories/dwigital-display.repository.js');
  const storeView=read('views/pages/store.ejs');

  const homeStart=controller.indexOf('async function home(');
  const storeStart=controller.indexOf('async function store(',homeStart);
  const detailStart=controller.indexOf('async function productDetail(',storeStart);

  assert.ok(homeStart>=0 && storeStart>homeStart && detailStart>storeStart);

  const homeController=controller.slice(homeStart,storeStart);
  const storeController=controller.slice(storeStart,detailStart);

  assert.match(homeController,/products\.homepageHighlights\(6\)/);
  assert.match(storeController,/displayRepo\.listPublicCatalog\(\)/);
  assert.doesNotMatch(storeController,/homepageHighlights/);

  const catalogStart=storeView.indexOf('<section class="store-provider-catalog"');
  assert.ok(catalogStart>=0);

  const catalogView=storeView.slice(catalogStart);
  assert.match(catalogView,/providerCatalog\.forEach\(root=>/);
  assert.match(catalogView,/category\.products\.forEach\(product=>/);
  assert.match(catalogView,/product\.display_name/);

  assert.match(
    catalogView,
    /<span class="product-title"><%= product\.display_name %><\/span>/,
    'Dwigital title must reuse regular product card typography'
  );

  assert.doesNotMatch(
    catalogView,
    /<h3 class="product-title">/,
    'Dwigital card must not use heading defaults'
  );
  assert.doesNotMatch(catalogView,/product\.variants\.forEach/);
  assert.doesNotMatch(catalogView,/variant\.display_name|variant\.retail_price/);
  assert.match(catalogView,/href="\/store\/dwigital\/<%= product\.provider_type %>\/<%= encodeURIComponent\(product\.provider_product_id\) %>"/);

  assert.match(repository,/async function findProviderProduct\(type,providerProductId,\{publicOnly=false\}=\{\}\)/);
  assert.match(repository,/product\.is_visible=true/);
  assert.match(repository,/category\.is_active=true/);
  assert.match(repository,/root\.is_active=true/);
  assert.match(repository,/variant\.is_visible=true\s+AND variant\.retail_price IS NOT NULL/);
  assert.match(repository,/provider_type:\s*row\.provider_type/);
  assert.match(repository,/provider_product_id:\s*row\.provider_product_id/);

  assert.match(routes,/pageRouter\.get\('\/store\/dwigital\/:type\/:productId',asyncHandler\(page\.dwigitalProductDetail\)\)/);
  assert.match(controller,/async function dwigitalProductDetail\(req,res,next\)/);
  assert.match(controller,/displayRepo\.findProviderProduct\(\s*type,\s*productId,\s*\{\s*publicOnly\s*:\s*true\s*\}\s*\)/);

  const detailPath=path.join(root,'views/pages/dwigital-product-detail.ejs');
  assert.ok(fs.existsSync(detailPath),'Halaman detail Dwigital harus tersedia');

  const detailView=read('views/pages/dwigital-product-detail.ejs');
  assert.match(detailView,/providerProduct\.variants\.forEach/);
  assert.match(detailView,/variant\.display_name/);
  assert.match(detailView,/formatIDR\(variant\.retail_price\)/);
  assert.doesNotMatch(
    detailView,
    /data-buy-now|data-add-cart/
);
assert.match(detailView,/data-product-purchase-sheet/);
});



test('Dwigital detail login link uses the canonical auth route',()=>{
  const detailView=read('views/pages/dwigital-product-detail.ejs');

  assert.match(detailView,/href="\/auth\/login"/);
  assert.doesNotMatch(detailView,/href="\/login"/);
});


test('Dwigital detail page reuses local product detail presentation components',()=>{
  const localView=read('views/pages/product-detail.ejs');
  const dwigitalView=read('views/pages/dwigital-product-detail.ejs');

  const sharedClasses=[
    'detail-media',
    'detail-share-button',
    'detail-image-frame',
    'detail-image-open',
    'detail-product-stats',
    'detail-product-stat',
    'detail-copy',
    'detail-title-row',
    'detail-description-heading',
    'detail-description',
    'detail-variant-card',
    'detail-variant-title',
    'detail-variant-options',
    'product-variant-card-option'
  ];

  const hasClass=(markup,className)=>(
    [...markup.matchAll(/\bclass=["']([^"']+)["']/g)]
      .some(match=>match[1].split(/\s+/).includes(className))
  );

  for(const component of sharedClasses){
    assert.ok(
      hasClass(localView,component),
      `Komponen canonical tidak ditemukan di halaman lokal: ${component}`
    );

    assert.ok(
      hasClass(dwigitalView,component),
      `Dwigital belum menggunakan komponen canonical: ${component}`
    );
  }

  const sharedAttributes=[
    'data-product-share',
    'data-product-image-open',
    'data-image-fallback',
    'data-product-variant-selected-icon'
  ];

  for(const attribute of sharedAttributes){
    assert.ok(localView.includes(attribute),`Atribut lokal tidak ditemukan: ${attribute}`);
    assert.ok(dwigitalView.includes(attribute),`Atribut Dwigital tidak ditemukan: ${attribute}`);
  }

  assert.match(dwigitalView,/href="\/auth\/login"/);
  assert.match(dwigitalView,/data-dwigital-purchase-form/);
  assert.match(dwigitalView,/data-dwigital-target/);
  assert.match(dwigitalView,/data-dwigital-zone/);
  assert.match(dwigitalView,/data-dwigital-balance/);
  assert.match(dwigitalView,/data-dwigital-gateway/);
  assert.match(dwigitalView,/data-dwigital-submit/);
});

test('Dwigital detail form supports supplier-priced variants and buyer payment',()=>{
  const detailView=read('views/pages/dwigital-product-detail.ejs');
  const controller=read('src/controllers/page.controller.js');

  assert.match(detailView,/data-dwigital-purchase-form/);
  assert.match(detailView,/data-dwigital-variant/);
  assert.match(detailView,/data-dwigital-submit/);
  assert.match(detailView,/targetZone/);
  assert.match(detailView,/paymentMethod/);
  assert.match(detailView,/JYYRApi\.request/);
  assert.match(detailView,/extra_field|canPurchase/);
  assert.match(controller,/walletBalance/);
  assert.match(controller,/isAuthenticated/);
});


test('Dwigital permanent rejection state is migration-backed and refundable',()=>{
  const repository=read('src/repositories/dwigital-orders.repository.js');
  const refund=read('src/services/refund.service.js');
  const migration=read('database/migrations/052_dwigital_rejected_submission.sql');

  assert.match(repository,/async function setSubmissionRejected/);
  assert.match(repository,/d\.submission_state='rejected'/);
  assert.match(refund,/submissionRejected/);
  assert.match(migration,/submission_state[\s\S]*'rejected'/);
});


test('Dwigital detail page exposes metrics and canonical sections',()=>{
  const controller=read('src/controllers/page.controller.js');
  const repository=read('src/repositories/dwigital-display.repository.js');
  const detailView=read('views/pages/dwigital-product-detail.ejs');

  assert.match(repository,/recordProviderProductView/);
  assert.match(repository,/provider_purchase_counts/);
  assert.match(repository,/view_count/);
  assert.match(repository,/purchase_count/);

  assert.match(controller,/recordProviderProductView/);
  assert.match(controller,/relatedProducts/);
  assert.match(controller,/bestSellerProducts/);

  assert.match(detailView,/detail-product-stats/);
  assert.match(detailView,/product-detail-info/);
  assert.match(detailView,/product-reviews-section/);
  assert.match(detailView,/product-detail-recommendations/);
  assert.match(detailView,/data-product-purchase-sheet/);
  assert.match(detailView,/id="dwigital-purchase-form"/);

  const form=detailView.match(
    /<form\b(?=[^>]*\bdata-dwigital-purchase-form\b)[^>]*>([\s\S]*?)<\/form>/
  );

  assert.ok(form,'Dwigital purchase form must exist');

  assert.match(
    form[1],
    /data-product-purchase-sheet/,
    'Action sheet must remain inside the purchase form'
  );

  assert.match(
    form[1],
    /data-dwigital-submit/,
    'Purchase submit must remain inside the purchase form'
  );
});

test('Dwigital order detail uses owner-scoped decrypted supplier result',()=>{
  const controller=read('src/controllers/page.controller.js');
  const detailView=read('views/pages/order-detail.ejs');

  const start=controller.indexOf('async function orderDetail(');
  const end=controller.indexOf('async function history(',start);
  assert.ok(start>=0&&end>start);

  const handler=controller.slice(start,end);
  const serviceCall=handler.indexOf('getOrderForUser');
  const paymentGate=handler.indexOf("if(!['PAID','PROCESSING','COMPLETED']");

  assert.ok(serviceCall>=0&&paymentGate>serviceCall);
  assert.match(handler,/dwigitalOrder/);
  assert.match(handler,/findLatestForOrderForUser/);
  assert.match(detailView,/<% if\(dwigitalOrder\)\{ %>/);
  assert.match(detailView,/supplier_accounts/);
  assert.match(detailView,/supplier_note/);
  assert.match(detailView,/targetZone/);
});

test('Owner provider-products page uses existing protected owner routing',()=>{
  const routes=read('src/routes/index.js');
  const sidebar=read('views/partials/sidebar.ejs');
  const view=read('views/owner/index.ejs');
  const browser=read('public/js/pages.js');

  assert.match(routes,/provider-products/);
  assert.match(sidebar,/Produk Provider/);
  const providerForm=view.match(
    /<form\s+class="([^"]*)"\s+data-provider-product-form/
  );
  assert.ok(providerForm,'Provider product edit form must exist');
  assert.equal(
    providerForm[1].split(/\s+/).includes('panel'),
    false,
    'Provider editor form must not restore the large wrapper panel'
  );

  const providerEditorStart = view.indexOf(
    '<div class="owner-product-editor-page" data-owner-product-page="edit_produk">'
  );
  const providerVariantsStart = view.indexOf(
    '<% if(!(providerProduct.variants||[]).length){ %>',
    providerEditorStart
  );

  assert.ok(
    providerEditorStart >= 0 &&
    providerVariantsStart > providerEditorStart,
    'Provider editor wrapper and variant list must exist'
  );

  const providerEditorMarkup = view.slice(
    providerEditorStart,
    providerVariantsStart
  );

  assert.match(
    providerEditorMarkup,
    /^<div class="owner-product-editor-page" data-owner-product-page="edit_produk">\s*<form\s+class="product-form-modal"[\s\S]*?<header class="product-modal-head">/
  );
  assert.match(providerEditorMarkup, /class="product-modal-section"/);
  assert.match(providerEditorMarkup, /class="product-modal-section-title"/);
  assert.match(providerEditorMarkup, /class="product-modal-grid"/);
  assert.match(providerEditorMarkup, /class="product-thumbnail-box"/);
  assert.match(providerEditorMarkup, /class="product-upload-info"/);

  assert.ok(
    providerEditorMarkup.includes('data-jyyr-file-picker'),
    'Provider cover must use the canonical file picker'
  );
  assert.ok(
    providerEditorMarkup.includes('data-thumbnail-input'),
    'Provider cover must reuse the canonical thumbnail preview handler'
  );
  assert.ok(
    providerEditorMarkup.includes('data-provider-cover-progress') &&
    providerEditorMarkup.includes('data-provider-cover-status'),
    'Provider cover upload progress and status hooks must remain'
  );

  assert.match(
    view.slice(providerVariantsStart),
    /<article\s+class="product-modal-section stack-form"\s+data-provider-variant/
  );
  assert.match(
    view.slice(providerVariantsStart),
    /class="product-modal-grid"/
  );
  assert.match(
    view.slice(providerVariantsStart),
    /class="product-modal-actions"/
  );

  const providerVariantMarkup = view.slice(providerVariantsStart);

  assert.ok(
    providerVariantMarkup.includes('data-jyyr-file-picker'),
    'Provider variant icon must use the canonical file picker'
  );
  assert.ok(
    providerVariantMarkup.includes('data-provider-variant-icon-file'),
    'Provider variant icon input hook must remain'
  );
  assert.ok(
    providerVariantMarkup.includes('data-provider-variant-progress') &&
    providerVariantMarkup.includes('data-provider-variant-status'),
    'Provider variant upload progress and status hooks must remain'
  );

  const providerVariantCardStart=providerVariantMarkup.indexOf('<article');
  const providerVariantCardEnd=providerVariantMarkup.indexOf(
    '</article>',
    providerVariantCardStart
  );

  assert.ok(
    providerVariantCardStart>=0 &&
    providerVariantCardEnd>providerVariantCardStart,
    'Provider variant card must exist'
  );

  const providerVariantCard=providerVariantMarkup.slice(
    providerVariantCardStart,
    providerVariantCardEnd
  );

  assert.ok(
    providerVariantCard.includes('data-thumbnail-stage') &&
    providerVariantCard.includes('data-thumbnail-input') &&
    providerVariantCard.includes('data-current-thumbnail') &&
    providerVariantCard.includes('data-thumbnail-preview') &&
    providerVariantCard.includes('data-thumbnail-empty') &&
    providerVariantCard.includes('data-thumbnail-status'),
    'Provider variant icon must reuse scoped thumbnail preview'
  );

  assert.ok(
    browser.includes(
      "const scope=input.closest('[data-provider-variant]')||input.closest('form');"
    ),
    'Thumbnail preview must target its provider variant card'
  );
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


test('Owner provider-products page follows canonical Owner product UI',()=>{
  const view=read('views/owner/index.ejs');
  const repository=read('src/repositories/dwigital-display.repository.js');
  const browser=read('public/js/pages.js');
  const responsive=read('public/css/responsive.css');

  const start=view.indexOf("else if(ownerSection==='provider-products'){");
  const end=view.indexOf("else if(ownerSection==='products'){",start);

  assert.ok(start>=0 && end>start,'Provider page branch exists');

  const providerView=view.slice(start,end);

  // JYYR_PROVIDER_CARD_DIRECT_EDIT_ASSERTIONS
  const cardClassIndex=providerView.indexOf(
    'class="owner-product-card"'
  );
  const directCardStart=providerView.lastIndexOf('<a',cardClassIndex);
  const directCardOpenEnd=providerView.indexOf('>',cardClassIndex);
  const directCardEnd=providerView.indexOf('</a>',directCardOpenEnd);

  assert.ok(
    directCardStart>=0 &&
    directCardOpenEnd>directCardStart &&
    directCardEnd>directCardOpenEnd,
    'Provider product card must be a direct edit link'
  );

  const directCardOpening=providerView.slice(
    directCardStart,
    directCardOpenEnd+1
  );

  assert.ok(directCardOpening.startsWith('<a'));
  assert.ok(directCardOpening.includes('class="owner-product-card"'));

  assert.ok(
    directCardOpening.includes('href="<%='),
    'Provider card anchor must start its href with the EJS expression'
  );

  const directCard=providerView.slice(
    directCardStart,
    directCardEnd+4
  );

  assert.ok(
    directCard.includes('editUrl %>"'),
    'Provider card href must use editUrl'
  );
  assert.equal(directCard.includes('data-owner-product-card'),false);
  assert.equal(directCard.includes('data-owner-product-actions'),false);
  assert.equal(directCard.slice(1).includes('<a'),false);

  assert.equal(providerView.includes('data-owner-product-actions'),false);
  assert.equal(providerView.includes('data-owner-product-card'),false);

  assert.ok(
    browser.includes('function openOwnerProductActionsSheet(card)'),
    'Canonical product action sheet remains available on /owner/products'
  );

  const directCardCssStart=responsive.indexOf(
    '.owner-page .owner-product-card{'
  );
  const directCardCssEnd=responsive.indexOf('}',directCardCssStart);

  assert.ok(
    directCardCssStart>=0 && directCardCssEnd>directCardCssStart,
    'Canonical owner card style exists'
  );

  const directCardCss=responsive.slice(
    directCardCssStart,
    directCardCssEnd+1
  );

  assert.ok(directCardCss.includes('color:inherit;'));
  assert.ok(directCardCss.includes('text-decoration:none;'));


  // JYYR_PROVIDER_LIST_LAYOUT_COLOR_ASSERTIONS
  assert.equal(
    providerView.includes('<h2>Daftar produk provider</h2>'),
    false
  );
  assert.equal(
    providerView.includes('Pilih tombol Edit pada kartu produk'),
    false
  );
  assert.equal(
    providerView.includes('<h2>Kategori tampilan</h2>'),
    false
  );
  assert.equal(
    providerView.includes('Kategori utama Aplikasi Premium dan Game memiliki subkategori.'),
    false
  );
  assert.equal(
    providerView.includes('Atur nama, icon, urutan, serta statusnya di sini.'),
    false
  );

  const providerListStart=providerView.indexOf(
    '<section class="owner-product-list-panel">'
  );
  const providerListEnd=providerView.indexOf('</section>',providerListStart);

  assert.ok(providerListStart>=0 && providerListEnd>providerListStart);

  const providerList=providerView.slice(
    providerListStart,
    providerListEnd
  );

  assert.equal(providerList.includes('class="panel"'),false);

  const categoryIf=providerView.indexOf(
    '<% if(!(providerCategories||[]).length){ %>'
  );
  const categoryStart=providerView.lastIndexOf('<section',categoryIf);
  const categoryTagEnd=providerView.indexOf('>',categoryStart);

  assert.ok(categoryIf>0 && categoryStart>=0 && categoryTagEnd>categoryStart);
  assert.equal(
    providerView.slice(categoryStart,categoryTagEnd+1),
    '<section>'
  );

  const titleStart=providerView.indexOf(
    '<h3 class="owner-product-card-title">'
  );
  const providerId=providerView.indexOf(
    'ID provider: <%= product.provider_product_id %>'
  );
  const titleEnd=providerView.indexOf('</h3>',titleStart);

  assert.ok(
    titleStart>=0 && providerId>titleStart && titleEnd>providerId,
    'Provider ID must remain inside the product title'
  );

  const cardStart=responsive.indexOf(
    '.owner-page .owner-product-card{'
  );
  const cardEnd=responsive.indexOf('}',cardStart);

  assert.ok(cardStart>=0 && cardEnd>cardStart);

  const cardRule=responsive.slice(cardStart,cardEnd+1);

  assert.ok(
    cardRule.includes('background:var(--surface);'),
    'Canonical product card must use the surface token'
  );

  assert.match(providerView,/class="owner-filter-bar"/);
  assert.match(providerView,/owner-filter-field owner-filter-search/);
  assert.match(providerView,/owner-product-card-grid/);
  assert.match(providerView,/class="owner-product-card"/);
  assert.match(providerView,/owner-product-card-title/);
  assert.match(providerView,/owner-product-card-metrics/);
  assert.doesNotMatch(providerView,/data-owner-product-card/);
  assert.ok(directCard.includes('aria-label="Edit '), 'Direct edit link must remain accessible');
  assert.doesNotMatch(providerView,/<template data-owner-product-actions>/);
  assert.doesNotMatch(providerView,/owner-provider-product-card-actions/);
  assert.match(providerView,/assetUrl\(publicAssetBucket,product\.cover_path\)/);
  assert.doesNotMatch(providerView,/<table>/);
  assert.match(providerView,/owner-categories-grid/);
  assert.match(providerView,/owner-category-card/);

  const listStart=repository.indexOf('async function listProviderProducts(');
  const listEnd=repository.indexOf('async function countProviderProducts(',listStart);

  assert.ok(listStart>=0 && listEnd>listStart,'Provider listing query exists');

  const listing=repository.slice(listStart,listEnd);
  assert.match(listing,/product\.cover_path/);
  assert.match(listing,/GROUP BY[\s\S]*product\.cover_path/);

  assert.ok(browser.includes("const swipe=event.target.closest('[data-owner-product-swipe]');"));
  assert.ok(browser.includes("const card=swipe.querySelector('[data-owner-product-card]');"));
  assert.ok(browser.includes("if(swipe.classList.contains('is-delete-revealed')){"));
  assert.doesNotMatch(responsive,/owner-provider-product-card-actions/);

  assert.match(providerView,/data-provider-product-form/);
  assert.match(providerView,/data-provider-variant-price/);
  assert.match(providerView,/data-provider-margin/);
  assert.match(providerView,/data-provider-cover-file/);
  assert.match(providerView,/data-provider-variant-icon-file/);
  assert.match(providerView,/data-owner-provider-category-edit/);
});
