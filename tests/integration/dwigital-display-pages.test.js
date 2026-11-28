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
  const checkoutView=read('views/pages/checkout.ejs');

  const sharedClasses=[
    'detail-media',
    'detail-share-button',
    'detail-image-frame',
    'detail-image-open',
    'detail-product-stats',
    'detail-product-stat',
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

  assert.ok(
    hasClass(localView,'detail-copy'),
    'Halaman produk lokal tetap memakai detail-copy canonical'
  );

  assert.doesNotMatch(
    dwigitalView,
    /class=["'][^"']*detail-copy[^"']*["']/,
    'Dwigital tidak boleh memakai wrapper card detail-copy'
  );

  assert.match(dwigitalView,/class="dwigital-product-copy"/);

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

  const localStatsStart=localView.indexOf(
    '<div class="detail-product-stats" aria-label="Statistik produk">'
  );
  const localStatsEnd=localView.indexOf(
    "<% if(product.pricing_mode==='VARIANT')",
    localStatsStart
  );

  const dwigitalStatsStart=dwigitalView.indexOf(
    '<div class="detail-product-stats"'
  );
  const dwigitalStatsEnd=dwigitalView.indexOf(
    '<form\n      id="dwigital-purchase-form"',
    dwigitalStatsStart
  );

  assert.ok(localStatsStart>=0&&localStatsEnd>localStatsStart);
  assert.ok(dwigitalStatsStart>=0&&dwigitalStatsEnd>dwigitalStatsStart);

  const localStats=localView.slice(localStatsStart,localStatsEnd);
  const dwigitalStats=dwigitalView.slice(
    dwigitalStatsStart,
    dwigitalStatsEnd
  );

  for(const marker of [
    'category-name-with-icon',
    "icon('eye')",
    "icon('tag-sale-price')",
    "notation: 'compact'"
  ]){
    assert.ok(localStats.includes(marker),`Local marker: ${marker}`);
    assert.ok(
      dwigitalStats.includes(marker),
      `Dwigital statistik harus memakai pola canonical lokal: ${marker}`
    );
  }

  assert.doesNotMatch(dwigitalStats,/icon\('package'\)/);
  assert.match(dwigitalView,/data-dwigital-purchase-form/);
  assert.match(dwigitalView,/data-dwigital-target/);
  assert.match(dwigitalView,/data-dwigital-zone/);
  assert.doesNotMatch(
    dwigitalView,
    /data-dwigital-balance|data-dwigital-gateway|dwigitalPaymentMethod/
  );
  assert.match(checkoutView,/name="paymentMethod"/);
  assert.match(dwigitalView,/data-dwigital-submit/);
});


test('Dwigital variant cards use product cover when a variant icon is missing',()=>{
  const detailView=read('views/pages/dwigital-product-detail.ejs');
  const variantsStart=detailView.indexOf('providerProduct.variants.forEach');
  const variantsEnd=detailView.indexOf(
    '<span class="product-variant-card-details">',
    variantsStart
  );
  const variantsMarkup=detailView.slice(variantsStart,variantsEnd);

  assert.ok(variantsStart>=0&&variantsEnd>variantsStart);
  assert.match(variantsMarkup,/variant\.icon_url\s*\|\|\s*providerProductCoverUrl/);
  assert.match(variantsMarkup,/src="<%= variant\.icon_url\s*\|\|\s*providerProductCoverUrl %>"/);
});

test('Dwigital header keeps selected price aligned with variant title',()=>{
  const detailView=read('views/pages/dwigital-product-detail.ejs');
  const pagesCss=read('public/css/pages.css');

  const form=detailView.match(
    /<form\b(?=[^>]*\bdata-dwigital-purchase-form\b)[^>]*>([\s\S]*?)<\/form>/
  );

  assert.ok(form,'Dwigital purchase form must exist');

  const heading=form[1].match(
    /<div class="dwigital-variant-heading">([\s\S]*?)<\/div>/
  );

  assert.ok(
    heading,
    'Variant heading and selected price must share one header row'
  );

  assert.match(
    heading[1],
    /<h2 class="detail-variant-title" id="dwigital-variant-title">[\s\S]*Pilihan Varian &amp; Harga[\s\S]*<\/h2>/
  );

  assert.match(
    heading[1],
    /<strong class="dwigital-variant-total" data-dwigital-total>—<\/strong>/
  );

  assert.equal(
    (form[1].match(/data-dwigital-total/g)||[]).length,
    1,
    'Selected price must have exactly one canonical element'
  );

  assert.doesNotMatch(
    form[1],
    /summary-row total|Total pembayaran/,
    'Separate total payment row must be removed'
  );

  assert.doesNotMatch(
    form[1],
    /Harga dan ketersediaan akan diverifikasi ulang ke supplier/,
    'Supplier helper text must be removed'
  );

  assert.match(
    detailView,
    /const total=form\.querySelector\('\[data-dwigital-total\]'\);/,
    'Existing selected-price updater must remain connected'
  );

  assert.match(
    detailView,
    /total\.textContent=money\(selectedPrice\);/,
    'Selected variant must continue updating the displayed price'
  );

  assert.match(
    pagesCss,
    /\.dwigital-variant-heading\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:space-between/s
  );

  assert.match(
    pagesCss,
    /\.dwigital-variant-heading \.detail-variant-title\{[^}]*margin:0/s
  );

  assert.match(
    pagesCss,
    /\.dwigital-variant-total\{[^}]*white-space:nowrap/s
  );
});

test('Dwigital detail form hands off variants to shared checkout',()=>{
  const detailView=read('views/pages/dwigital-product-detail.ejs');
  const controller=read('src/controllers/page.controller.js');
  const checkoutView=read('views/pages/checkout.ejs');
  const browser=read('public/js/pages.js');

  assert.match(detailView,/data-dwigital-purchase-form/);
  assert.match(detailView,/data-dwigital-variant/);
  assert.match(detailView,/data-dwigital-submit/);
  assert.match(detailView,/targetZone/);
  assert.match(detailView,/\/api\/dwigital\/checkout/);
  assert.doesNotMatch(detailView,/\/api\/dwigital\/orders/);
  assert.match(checkoutView,/name="paymentMethod"/);
  assert.match(browser,/\/api\/dwigital\/orders/);
  assert.match(detailView,/JYYRApi\.request/);
  assert.match(detailView,/extra_field|canPurchase/);
  assert.match(controller,/wallet\.get\(req\.user\.id\)/);
  assert.match(controller,/isAuthenticated/);
});



test('Dwigital purchase sheet adds a live selected variant card above buy now',()=>{
  const detailView=read('views/pages/dwigital-product-detail.ejs');
  const pagesCss=read('public/css/pages.css');

  const cardIndex=detailView.indexOf(
    'data-dwigital-selected-variant-card'
  );
  const submitIndex=detailView.indexOf('data-dwigital-submit');

  assert.ok(
    cardIndex>=0&&submitIndex>cardIndex,
    'Selected variant card must be added before the buy button'
  );

  for(const marker of [
    'data-dwigital-selected-variant-icon',
    'data-dwigital-selected-variant-name',
    'data-dwigital-selected-variant-price'
  ]){
    assert.ok(detailView.includes(marker),`Missing selected variant field: ${marker}`);
  }

  assert.match(
    detailView,
    /option\.querySelector\(\s*'\.product-variant-card-details strong'\s*\)/
  );
  assert.match(
    detailView,
    /option\.querySelector\(\s*'\.product-variant-card-price'\s*\)/
  );
  assert.match(
    detailView,
    /sourceIcon\.childNodes[\s\S]*node=>node\.cloneNode\(true\)/
  );
  assert.match(detailView,/selectedVariantCard\.hidden=false;/);
  assert.match(
    detailView,
    /const submitLabel=submit\?\.querySelector\('\[data-dwigital-submit-label\]'\)\|\|null;/,
    'External submit label must be resolved from the external submit button'
  );

  assert.match(
    pagesCss,
    /\.dwigital-selected-variant-card\{[^}]*grid-column:1\/-1/s
  );
  assert.match(
    pagesCss,
    /\.dwigital-selected-variant-card\[hidden\]\{[^}]*display:none/s
  );
  assert.match(
    pagesCss,
    /\.product-purchase-sheet-actions > \[data-dwigital-submit\]\{[^}]*grid-column:1\/-1/s
  );

  const purchaseSheet=detailView.match(
    /<details\b(?=[^>]*\bdata-product-purchase-sheet\b)[^>]*>/
  );

  assert.ok(purchaseSheet,'Dwigital purchase sheet must exist');

  assert.match(
    purchaseSheet[0],
    /\shidden(?:\s|>)/,
    'Action sheet must initially be hidden'
  );

  assert.doesNotMatch(
    purchaseSheet[0],
    /\sopen(?:\s|>)/,
    'Action sheet must not initially be open'
  );

  assert.match(detailView,/aria-expanded="false"/);
  assert.match(detailView,/aria-label="Buka panel aksi pembelian"/);

  assert.match(
    detailView,
    /purchaseSheet\.hidden=false;\s*purchaseSheet\.open=true;/
  );

  const variantClickIndex=detailView.indexOf(
    "options.forEach(option=>{\n      option.addEventListener('click',()=>selectVariant(option));\n    });"
  );

  const authenticationGuardIndex=detailView.indexOf(
    "if(!authenticated||!submit||!submitLabel)return;"
  );

  assert.ok(
    variantClickIndex>=0&&authenticationGuardIndex>variantClickIndex,
    'Guests must be able to reveal the action sheet after variant selection'
  );

  assert.equal(
    (detailView.match(/item\.classList\.toggle\('active',active\)/g)||[]).length,
    1,
    'Only one canonical variant active-state loop must exist'
  );

  assert.doesNotMatch(detailView,/const firstAvailable=options\.find/);
  assert.doesNotMatch(detailView,/selectVariant\(firstAvailable\)/);
});


test('Dwigital checkout uses the shared local checkout before creating an order',()=>{
  const detailView=read('views/pages/dwigital-product-detail.ejs');
  const checkoutView=read('views/pages/checkout.ejs');
  const browser=read('public/js/pages.js');
  const routes=read('src/routes/index.js');
  const api=read('src/controllers/api.controller.js');
  const controller=read('src/controllers/page.controller.js');

  assert.ok(
    detailView.includes("'/api/dwigital/checkout'"),
    'Dwigital detail must stage checkout before creating an order'
  );

  assert.doesNotMatch(detailView,/\/api\/dwigital\/orders/);

  const sheetStart=detailView.indexOf(
    '<details\n    class="product-purchase-sheet"'
  );
  const sheetEnd=detailView.indexOf('</details>',sheetStart);
  assert.ok(sheetStart>=0&&sheetEnd>sheetStart);

  const sheet=detailView.slice(sheetStart,sheetEnd);

  assert.doesNotMatch(
    sheet,
    /payment-group|dwigitalPaymentMethod/,
    'Payment choices must live on the shared checkout page'
  );

  assert.match(routes,/const dwigitalCheckoutSchema=dwigitalOrderSchema\.omit/);
  assert.ok(routes.includes("apiRouter.post('/dwigital/checkout'"));
  assert.match(
    routes,
    /apiRouter\.post\('\/dwigital\/checkout',requireAuth,sensitiveRateLimit\(\),validate\(dwigitalCheckoutSchema\)/
  );

  assert.match(api,/prepareCheckout:async\(req,res\)=>/);
  assert.match(api,/req\.session\.dwigitalCheckout/);
  assert.match(api,/delete req\.session\.dwigitalCheckout/);
  assert.match(
    api,
    /assertOrderPaymentMode\(\s*created\.order,\s*method\s*===\s*'BALANCE'\s*\?\s*'BALANCE'\s*:\s*'LIVE'\s*\)/
  );

  assert.match(controller,/req\.session\?\.dwigitalCheckout/);
  assert.match(controller,/findProviderProduct\(/);
  assert.match(controller,/view:'pages\/checkout'/);

  assert.match(checkoutView,/preview\.dwigital\.target/);
  assert.match(checkoutView,/data-dwigital-checkout=/);
  assert.match(checkoutView,/data-dwigital-target=/);
  assert.match(checkoutView,/data-checkout-ready="[^"]*"/);
  assert.match(checkoutView,/name="paymentMethod"/);

  assert.match(
    browser,
    /const isDwigitalCheckout=checkout\.dataset\.dwigitalCheckout==='1'/
  );
  assert.match(browser,/api\.request\(\s*'\/api\/dwigital\/orders'/);
  assert.match(browser,/checkout\.dataset\.dwigitalProductId/);
  assert.match(browser,/checkout\.dataset\.dwigitalTarget/);
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



test('Dwigital product title and information remain grouped without a card below variants',()=>{
  const detailView=read('views/pages/dwigital-product-detail.ejs');
  const pageStyles=read('public/css/pages.css');

  assert.equal(
    detailView.includes('Temukan pilihan digital lainnya di'),
    false,
    'CTA katalog harus dihapus'
  );

  assert.match(
    pageStyles,
    /\.dwigital-purchase-form \.stack-form > \.field > span\{[^}]*padding-left:6px;/s,
    'Label Target dan Zone harus bergeser 6px ke kanan'
  );

  assert.match(
    pageStyles,
    /\.dwigital-purchase-form \.stack-form\{[^}]*margin-top:6px;/s,
    'Seluruh kelompok input Target dan Zone harus turun 6px'
  );

  const form=detailView.match(
    /<form\b(?=[^>]*\bdata-dwigital-purchase-form\b)[^>]*>[\s\S]*?<\/form>/
  );
  assert.ok(form,'Dwigital variant form must exist');

  const cardStart=detailView.indexOf('<div class="dwigital-product-copy">');
  const headingStart=detailView.indexOf(
    '<h2 class="detail-description-heading">Informasi Produk</h2>',
    cardStart
  );
  const descriptionEnd=detailView.indexOf('</p>',headingStart);
  const cardEnd=detailView.indexOf('</div>',descriptionEnd)+6;

  assert.ok(cardStart>=0&&headingStart>cardStart);
  assert.ok(descriptionEnd>headingStart&&cardEnd>descriptionEnd);

  const formEnd=detailView.indexOf('</form>',form.index)+7;
  assert.ok(
    cardStart>formEnd,
    'Complete product information card must follow the variant form'
  );

  const cardMarkup=detailView.slice(cardStart,cardEnd);

  assert.doesNotMatch(
    cardMarkup,
    /detail-copy/,
    'Product information text must not use the card styling class'
  );

  assert.match(
    cardMarkup,
    /<div class="detail-title-row">\s*<h1><%= providerProduct\.display_name %><\/h1>/
  );
  assert.match(
    cardMarkup,
    /<h2 class="detail-description-heading">Informasi Produk<\/h2>/
  );
  assert.match(cardMarkup,/class="detail-description"/);

  assert.equal(
    (detailView.match(/<div class="dwigital-product-copy">/g)||[]).length,
    1,
    'Product name and information must remain in one unboxed text group'
  );

  assert.doesNotMatch(
    form[0],
    /<h1>|Informasi Produk|detail-description/
  );
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

  const statsStart=detailView.indexOf('<div class="detail-product-stats"');
  const statsEnd=detailView.indexOf(
    '<form\n      id="dwigital-purchase-form"',
    statsStart
  );

  assert.ok(statsStart>=0&&statsEnd>statsStart);

  const statsMarkup=detailView.slice(statsStart,statsEnd);

  assert.equal(
    (statsMarkup.match(/<div class="detail-product-stat">/g)||[]).length,
    3,
    'Dwigital stats must contain only three labels: category, views, and purchases'
  );

  assert.match(
    statsMarkup,
    /providerProduct\.category_parent_name\s*\|\|\s*'Katalog Digital'/
  );
  assert.doesNotMatch(
    statsMarkup,
    /providerProduct\.category_name/,
    'Cover statistics must show the main category without the subcategory'
  );

  assert.doesNotMatch(
    statsMarkup,
    /\bVarian\b|providerVariantCount/,
    'Total Varian label must be removed from Dwigital cover statistics'
  );

  const form=detailView.match(
    /<form\b(?=[^>]*\bdata-dwigital-purchase-form\b)[^>]*>([\s\S]*?)<\/form>/
  );

  assert.ok(form,'Dwigital purchase form must exist');

  assert.doesNotMatch(
    form[1],
    /data-product-purchase-sheet|data-dwigital-submit/,
    'Action sheet must sit outside the product detail card'
  );

  assert.match(
    detailView,
    /form="dwigital-purchase-form"/,
    'External purchase submit must remain associated with the Dwigital form'
  );

  assert.match(
    detailView,
    /const submit=Array\.from\(form\.elements\)\.find\(control=>control\.matches\('\[data-dwigital-submit\]'\)\)\|\|null;/,
    'Purchase script must resolve its associated external submit control'
  );

  const detailContainerEnd=detailView.indexOf(
    '\n  </div>\n\n  <details',
    form.index
  );
  const sheetIndex=detailView.indexOf(
    '<details\n    class="product-purchase-sheet"',
    form.index+form[0].length
  );
  const sheetScriptIndex=detailView.indexOf(
    '<script nonce=',
    sheetIndex
  );

  assert.ok(
    detailContainerEnd>=0 &&
    sheetIndex>detailContainerEnd &&
    sheetScriptIndex>sheetIndex,
    'Action sheet and initializer must sit after the product detail card'
  );
});

test('hidden Dwigital zone field stays hidden when selecting a variant without a zone',()=>{
  const detailView=read('views/pages/dwigital-product-detail.ejs');
  const styles=read('public/css/components.css');

  assert.match(detailView,/data-zone-visible="<%= zoneVisible \? '1' : '0' %>"/);
  assert.match(detailView,/zoneWrapper\.hidden=!zoneVisible/);
  assert.match(
    styles,
    /\.field:not\(\[hidden\]\)\{display:flex/,
    'Visible form fields use flex layout without overriding hidden state'
  );
});

test('Dwigital buyer recipient field uses a concise label',()=>{
  const detailView=read('views/pages/dwigital-product-detail.ejs');

  assert.match(
    detailView,
    /email pembeli[\s\S]*nama pembeli/i
  );
  assert.match(
    detailView,
    /'Nama atau Email'/
  );
  assert.match(
    detailView,
    /data-target-label="<%= targetLabel %>"/
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

test('Owner can show or hide all priced variants from the product editor',()=>{
  const providerView=read('views/owner/index.ejs');
  const pages=read('public/js/pages.js');

  assert.match(providerView,/data-provider-variants-toggle-all/);
  assert.match(providerView,/Tampilkan semua varian/);
  assert.match(providerView,/data-provider-variants-toggle-all-note/);
  assert.match(pages,/syncProviderVariantsVisibilityToggle/);
  assert.match(pages,/toggle\.checked&&hasPrice/);
});

test('Owner can reuse a sibling variant icon without uploading another file',()=>{
  const providerView=read('views/owner/index.ejs');
  const pages=read('public/js/pages.js');
  const routes=read('src/routes/index.js');
  const repository=read('src/repositories/dwigital-display.repository.js');

  assert.match(providerView,/data-provider-variant-icon-source/);
  assert.match(providerView,/other\.variant_id!==variant\.variant_id&&other\.icon_url/);
  assert.match(providerView,/data-icon-url="<%= other\.icon_url %>"/);
  assert.match(pages,/iconSourceVariantId:variant\.querySelector\('\[data-provider-variant-icon-source\]'\)/);
  assert.match(pages,/syncProviderVariantIconPreview/);
  assert.match(routes,/iconSourceVariantId:z\.string\(\)\.trim\(\)\.max\(128\)\.nullable\(\)\.optional\(\)/);
  assert.match(repository,/INVALID_DWIGITAL_ICON_SOURCE/);
  assert.match(repository,/icon_path=EXCLUDED\.icon_path/);
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
