const test=require('node:test');
const assert=require('node:assert/strict');

const {
  normalizeProviderProductSettings
}=require('../../src/repositories/dwigital-display.repository');

const sourceVariants=[
  {variant_id:'digital-variant-1',base_price:10000},
  {variant_id:'digital-variant-2',base_price:15000}
];

function validInput(overrides={}){
  return {
    categoryKey:'premium-editing',
    displayName:'Aplikasi Premium',
    sortOrder:10,
    isVisible:true,
    variants:[
      {
        variantId:'digital-variant-1',
        displayName:'Paket 1 Bulan',
        retailPrice:15000,
        sortOrder:10,
        isVisible:true
      },
      {
        variantId:'digital-variant-2',
        displayName:'Paket 3 Bulan',
        retailPrice:20000,
        sortOrder:20,
        isVisible:false
      }
    ],
    ...overrides
  };
}

test('accepts sale prices above provider cost and calculates owner margin',()=>{
  const result=normalizeProviderProductSettings({
    type:'digital',
    providerProductId:'product-1',
    input:validInput(),
    sourceVariants
  });

  assert.equal(result.variants[0].basePrice,10000);
  assert.equal(result.variants[0].retailPrice,15000);
  assert.equal(result.variants[0].margin,5000);
});

test('allows a variant to reuse an existing icon from another variant of the product',()=>{
  const variantsWithIcons=[
    {
      ...sourceVariants[0],
      icon_path:'dwigital/digital/product-1/icon.webp'
    },
    {
      ...sourceVariants[1],
      icon_path:null
    }
  ];
  const input=validInput();
  input.variants[1].iconSourceVariantId='digital-variant-1';

  const result=normalizeProviderProductSettings({
    type:'digital',
    providerProductId:'product-1',
    input,
    sourceVariants:variantsWithIcons
  });

  assert.equal(
    result.variants[1].iconPath,
    'dwigital/digital/product-1/icon.webp'
  );
});

test('keeps a variant current icon when no replacement source is selected',()=>{
  const iconPath='dwigital/digital/product-1/icon.webp';
  const result=normalizeProviderProductSettings({
    type:'digital',
    providerProductId:'product-1',
    input:validInput(),
    sourceVariants:[
      {...sourceVariants[0],icon_path:iconPath},
      {...sourceVariants[1],icon_path:null}
    ]
  });

  assert.equal(result.variants[0].iconPath,iconPath);
  assert.equal(result.variants[1].iconPath,null);
});

test('rejects an icon source outside the product or without an icon',()=>{
  const input=validInput();
  input.variants[1].iconSourceVariantId='unknown-variant';

  assert.throws(
    ()=>normalizeProviderProductSettings({
      type:'digital',
      providerProductId:'product-1',
      input,
      sourceVariants:sourceVariants.map(variant=>({
        ...variant,
        icon_path:null
      }))
    }),
    error=>error.code==='INVALID_DWIGITAL_ICON_SOURCE'
  );
});

test('rejects sale prices below provider cost',()=>{
  const input=validInput();
  input.variants[0].retailPrice=9999;

  assert.throws(
    ()=>normalizeProviderProductSettings({
      type:'digital',
      providerProductId:'product-1',
      input,
      sourceVariants
    }),
    error=>error.code==='DWIGITAL_RETAIL_PRICE_BELOW_COST'
  );
});

test('requires at least one visible priced variant for a visible product',()=>{
  const input=validInput({
    variants:validInput().variants.map(variant=>({
      ...variant,
      isVisible:false
    }))
  });

  assert.throws(
    ()=>normalizeProviderProductSettings({
      type:'digital',
      providerProductId:'product-1',
      input,
      sourceVariants
    }),
    error=>error.code==='DWIGITAL_VISIBLE_PRODUCT_WITHOUT_VARIANT'
  );
});

test('rejects a category that belongs to another provider type',()=>{
  assert.throws(
    ()=>normalizeProviderProductSettings({
      type:'game',
      providerProductId:'product-1',
      input:validInput(),
      sourceVariants
    }),
    error=>error.code==='INVALID_DWIGITAL_DISPLAY_CATEGORY'
  );
});

test('rejects duplicate and unknown provider variant IDs',()=>{
  const input=validInput();
  input.variants[1].variantId=input.variants[0].variantId;

  assert.throws(
    ()=>normalizeProviderProductSettings({
      type:'digital',
      providerProductId:'product-1',
      input,
      sourceVariants
    }),
    error=>error.code==='INVALID_DWIGITAL_DISPLAY_VARIANTS'
  );
});

test('rejects visible variants without a sale price',()=>{
  const input=validInput();
  input.variants[0].retailPrice=null;

  assert.throws(
    ()=>normalizeProviderProductSettings({
      type:'digital',
      providerProductId:'product-1',
      input,
      sourceVariants
    }),
    error=>error.code==='DWIGITAL_VISIBLE_VARIANT_WITHOUT_PRICE'
  );
});
