const crypto=require('crypto');
const {loadEnv}=require('../config/env');
const catalogRepository=require('../repositories/dwigital-catalog.repository');
const {
  createDwigitalClient
}=require('../services/dwigital/dwigital.service');
const {
  syncCatalog
}=require('../services/dwigital/catalog.service');

const LEASE_MINUTES=15;
const RETRY_MINUTES=15;

function configuredInterval(value){
  const number=Number(value);

  if(
    !Number.isSafeInteger(number)||
    number<60||
    number>10080
  ){
    return 360;
  }

  return number;
}

function safeErrorCode(error){
  const supplied=String(
    error?.code||'DWIGITAL_SYNC_FAILED'
  ).toUpperCase();

  return /^[A-Z0-9_]{1,64}$/.test(supplied)
    ? supplied
    : 'DWIGITAL_SYNC_FAILED';
}

async function runDwigitalCatalogSync({
  env=loadEnv(),
  repository=catalogRepository,
  clientFactory=options=>createDwigitalClient(options),
  syncCatalog:runCatalogSync=syncCatalog
}={}){
  const apiKey=String(env.DWIGITAL_API_KEY||'').trim();

  if(!apiKey){
    return {status:'disabled'};
  }

  const intervalMinutes=configuredInterval(
    env.DWIGITAL_SYNC_INTERVAL_MINUTES
  );
  const leaseToken=crypto.randomUUID();

  const claim=await repository.claimSync({
    leaseToken,
    leaseMinutes:LEASE_MINUTES
  });

  if(claim?.acquired!==true){
    return {status:'skipped'};
  }

  try{
    const client=clientFactory({
      apiKey,
      baseUrl:env.DWIGITAL_API_BASE_URL
    });

    const result=await runCatalogSync({
      client,
      repository
    });

    await repository.completeSync({
      leaseToken,
      intervalMinutes
    });

    return {
      status:'synced',
      syncedCount:result.syncedCount,
      deactivatedCount:result.deactivatedCount
    };
  }catch(error){
    try{
      await repository.failSync({
        leaseToken,
        errorCode:safeErrorCode(error),
        retryMinutes:RETRY_MINUTES
      });
    }catch(stateError){
      error.syncStateError=stateError;
    }

    throw error;
  }
}

module.exports={runDwigitalCatalogSync};
