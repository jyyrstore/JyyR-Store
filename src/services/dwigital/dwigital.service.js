const PRODUCT_TYPES=Object.freeze([
  'game',
  'sosmed',
  'ppob',
  'digital'
]);

const DEFAULT_BASE_URL='https://dwigital.id/api/v1';
const DEFAULT_TIMEOUT_MS=15000;
const MAX_CATALOG_PAGES=10000;

function createError(code,message,status=502,cause){
  const error=new Error(
    message,
    cause ? {cause} : undefined
  );

  error.code=code;
  error.status=status;
  error.expose=false;

  return error;
}

function positiveInteger(value,name,{fallback,max=Number.MAX_SAFE_INTEGER}={}){
  const number=value===undefined||value===null
    ? fallback
    : Number(value);

  if(
    !Number.isSafeInteger(number)||
    number<1||
    number>max
  ){
    throw createError(
      'INVALID_DWIGITAL_PARAMETER',
      `${name} harus berupa bilangan bulat positif yang valid.`,
      400
    );
  }

  return number;
}

function createDwigitalClient(options={}){
  const apiKey=String(options.apiKey||'').trim();

  if(!apiKey){
    throw createError(
      'DWIGITAL_API_KEY',
      'DWIGITAL_API_KEY belum dikonfigurasi.',
      503
    );
  }

  let parsedBaseUrl;

  try{
    parsedBaseUrl=new URL(
      String(options.baseUrl||DEFAULT_BASE_URL).trim()
    );
  }catch(error){
    throw createError(
      'DWIGITAL_BASE_URL_INVALID',
      'DWIGITAL_BASE_URL tidak valid.',
      500,
      error
    );
  }

  if(
    parsedBaseUrl.protocol!=='https:'||
    parsedBaseUrl.username||
    parsedBaseUrl.password||
    parsedBaseUrl.search||
    parsedBaseUrl.hash
  ){
    throw createError(
      'DWIGITAL_BASE_URL_INVALID',
      'DWIGITAL_BASE_URL wajib menggunakan HTTPS dan tidak boleh berisi kredensial atau query.',
      500
    );
  }

  const baseUrl=parsedBaseUrl.toString().replace(/\/+$/,'');
  const fetchImpl=options.fetchImpl||global.fetch;
  const timeoutMs=positiveInteger(
    options.timeoutMs,
    'timeoutMs',
    {fallback:DEFAULT_TIMEOUT_MS}
  );

  if(typeof fetchImpl!=='function'){
    throw createError(
      'DWIGITAL_FETCH_UNAVAILABLE',
      'Runtime tidak menyediakan HTTP fetch.',
      503
    );
  }

  async function request(path,params=null){
    const url=new URL(
      String(path).replace(/^\/+/,''),
      `${baseUrl}/`
    );

    if(params instanceof URLSearchParams){
      url.search=params.toString();
    }

    const controller=new AbortController();
    const timer=setTimeout(
      ()=>controller.abort(),
      timeoutMs
    );

    let response;

    try{
      response=await fetchImpl(url.toString(),{
        method:'GET',
        headers:{
          accept:'application/json',
          authorization:`Bearer ${apiKey}`
        },
        signal:controller.signal
      });
    }catch(error){
      if(error?.name==='AbortError'){
        throw createError(
          'DWIGITAL_TIMEOUT',
          'Request ke Dwigital melewati batas waktu.',
          504,
          error
        );
      }

      throw createError(
        'DWIGITAL_NETWORK_ERROR',
        'Tidak dapat terhubung ke Dwigital API.',
        502,
        error
      );
    }finally{
      clearTimeout(timer);
    }

    let body;

    try{
      body=await response.json();
    }catch(error){
      throw createError(
        'DWIGITAL_INVALID_RESPONSE',
        'Dwigital mengembalikan respons JSON yang tidak valid.',
        502,
        error
      );
    }

    if(
      !body||
      typeof body!=='object'||
      Array.isArray(body)
    ){
      throw createError(
        'DWIGITAL_INVALID_RESPONSE',
        'Struktur respons Dwigital tidak valid.',
        502
      );
    }

    if(!response.ok||body.success===false){
      const rateLimited=response.status===429;
      const providerMessage=typeof body.message==='string'
        ? body.message.trim().slice(0,500)
        : '';

      throw createError(
        rateLimited
          ? 'DWIGITAL_RATE_LIMITED'
          : 'DWIGITAL_API_ERROR',
        providerMessage||
          `Dwigital API mengembalikan HTTP ${response.status}.`,
        rateLimited?429:502
      );
    }

    return body;
  }

  async function listProducts({
    type,
    q,
    productId,
    code,
    page=1,
    perPage=1000
  }={}){
    let normalizedType=null;

    if(type!==undefined&&type!==null&&String(type).trim()){
      normalizedType=String(type).trim().toLowerCase();

      if(!PRODUCT_TYPES.includes(normalizedType)){
        throw createError(
          'INVALID_DWIGITAL_PRODUCT_TYPE',
          'Tipe katalog Dwigital tidak valid.',
          400
        );
      }
    }

    const currentPage=positiveInteger(page,'page');
    const pageSize=positiveInteger(
      perPage,
      'perPage',
      {max:1000}
    );

    const params=new URLSearchParams();

    if(normalizedType)params.set('type',normalizedType);

    const search=String(q||'').trim();
    if(search)params.set('q',search);

    if(productId!==undefined&&productId!==null&&String(productId).trim()){
      params.set('product_id',String(productId).trim());
    }

    if(code!==undefined&&code!==null&&String(code).trim()){
      params.set('code',String(code).trim());
    }

    params.set('page',String(currentPage));
    params.set('per_page',String(pageSize));

    const body=await request('products',params);

    if(!Array.isArray(body.data)){
      throw createError(
        'DWIGITAL_INVALID_RESPONSE',
        'Data katalog Dwigital harus berupa array.',
        502
      );
    }

    return {
      data:body.data,
      meta:body.meta||{}
    };
  }

  async function listAllProducts({perPage=1000}={}){
    const pageSize=positiveInteger(
      perPage,
      'perPage',
      {max:1000}
    );

    const products=[];

    for(const type of PRODUCT_TYPES){
      let page=1;
      let lastPage=1;

      while(page<=lastPage){
        if(page>MAX_CATALOG_PAGES){
          throw createError(
            'DWIGITAL_PAGINATION_LIMIT',
            'Pagination katalog Dwigital melewati batas aman.',
            502
          );
        }

        const result=await listProducts({
          type,
          page,
          perPage:pageSize
        });

        const reportedLastPage=Number(result.meta?.last_page);

        if(
          !Number.isSafeInteger(reportedLastPage)||
          reportedLastPage<1||
          reportedLastPage<page||
          reportedLastPage>MAX_CATALOG_PAGES
        ){
          throw createError(
            'DWIGITAL_INVALID_PAGINATION',
            `Metadata pagination Dwigital untuk ${type} tidak valid.`,
            502
          );
        }

        lastPage=reportedLastPage;
        products.push(...result.data);
        page++;
      }
    }

    return products;
  }

  async function getProduct(variantId){
    const id=String(variantId??'').trim();

    if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)){
      throw createError(
        'INVALID_DWIGITAL_VARIANT_ID',
        'Variant ID Dwigital tidak valid.',
        400
      );
    }

    const body=await request(
      `products/${encodeURIComponent(id)}`
    );

    if(
      !body.data||
      typeof body.data!=='object'||
      Array.isArray(body.data)
    ){
      throw createError(
        'DWIGITAL_INVALID_RESPONSE',
        'Detail variant Dwigital tidak valid.',
        502
      );
    }

    return body.data;
  }

  return Object.freeze({
    listProducts,
    listAllProducts,
    getProduct
  });
}

module.exports={
  PRODUCT_TYPES,
  createDwigitalClient
};
