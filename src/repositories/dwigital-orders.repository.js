const {query,withTransaction}=require('../config/database');
const wallet=require('./wallet.repository');

function repositoryError(code,message,status=400){
  const error=new Error(message);
  error.code=code;
  error.status=status;
  error.expose=status<500;
  return error;
}

async function findByIdempotency(userId,idempotencyKey,client){
  const sql=`SELECT orders.*,dwigital_orders.supplier_reference,
                    dwigital_orders.supplier_status
             FROM orders
             JOIN dwigital_orders ON dwigital_orders.order_id=orders.id
             WHERE orders.user_id=$1 AND orders.idempotency_key=$2
             LIMIT 1`;
  const params=[userId,idempotencyKey];
  const result=client
    ? await client.query(sql,params)
    : await query(sql,params);

  return result.rows[0]||null;
}

async function createPurchase(input){
  const {
    userId,
    idempotencyKey,
    orderNumber,
    supplierReference,
    paymentMethod,
    type,
    productId,
    variantId,
    productName,
    variantName,
    targetEncrypted,
    retailPrice,
    supplierPrice,
    maxPrice,
    delivery
  }=input||{};

  if(
    !userId||
    !idempotencyKey||
    !orderNumber||
    !supplierReference||
    !['BALANCE','GATEWAY'].includes(paymentMethod)||
    !['digital','game'].includes(type)||
    !productId||
    !variantId||
    !targetEncrypted||
    !Number.isSafeInteger(retailPrice)||
    retailPrice<=0||
    !Number.isSafeInteger(supplierPrice)||
    supplierPrice<0||
    !Number.isSafeInteger(maxPrice)||
    maxPrice<supplierPrice||
    !['automatic','manual'].includes(delivery)
  ){
    throw repositoryError(
      'INVALID_DWIGITAL_PURCHASE',
      'Data pesanan Dwigital tidak valid.'
    );
  }

  try{
    return await withTransaction(async(client)=>{
      const existing=await findByIdempotency(
        userId,
        idempotencyKey,
        client
      );

      if(existing){
        return {
          order:existing,
          duplicate:true
        };
      }

      let walletRow=null;
      let balanceBefore=null;

      if(paymentMethod==='BALANCE'){
        await wallet.ensure(client,userId);

        walletRow=(
          await client.query(
            'SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE',
            [userId]
          )
        ).rows[0];

        balanceBefore=Number(walletRow.balance);

        if(balanceBefore<retailPrice){
          throw repositoryError(
            'INSUFFICIENT_BALANCE',
            'Saldo Wallet JYYR tidak mencukupi.'
          );
        }
      }

      const order=(
        await client.query(
          `INSERT INTO orders(
             order_number,user_id,subtotal,total,payment_method,status,
             idempotency_key,paid_at
           )
           VALUES(
             $1,$2,$3,$3,$4,$5,$6,
             CASE WHEN $4='BALANCE' THEN now() ELSE NULL END
           )
           RETURNING *`,
          [
            orderNumber,
            userId,
            retailPrice,
            paymentMethod,
            paymentMethod==='BALANCE'?'PAID':'PENDING',
            idempotencyKey
          ]
        )
      ).rows[0];

      const dwigitalOrder=(
        await client.query(
          `INSERT INTO dwigital_orders(
             order_id,supplier_reference,provider_type,provider_product_id,
             variant_id,product_name,variant_name,target_encrypted,
             retail_price,supplier_price,max_price,delivery,
             supplier_status,submission_state
           )
           VALUES(
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             'not_submitted','not_submitted'
           )
           RETURNING *`,
          [
            order.id,
            supplierReference,
            type,
            String(productId),
            String(variantId),
            productName,
            variantName,
            targetEncrypted,
            retailPrice,
            supplierPrice,
            maxPrice,
            delivery
          ]
        )
      ).rows[0];

      if(paymentMethod==='BALANCE'){
        const balanceAfter=balanceBefore-retailPrice;

        await client.query(
          `UPDATE wallets
           SET balance=$2,updated_at=now()
           WHERE user_id=$1`,
          [userId,balanceAfter]
        );

        await client.query(
          `INSERT INTO wallet_transactions(
             wallet_id,user_id,type,amount,balance_before,balance_after,
             reference,status,reason,metadata
           )
           VALUES(
             $1,$2,'PURCHASE',$3,$4,$5,$6,'COMPLETED',
             'Pembelian Dwigital',$7::jsonb
           )`,
          [
            walletRow.id,
            userId,
            retailPrice,
            balanceBefore,
            balanceAfter,
            orderNumber,
            JSON.stringify({
              orderId:order.id,
              supplierReference,
              provider:'dwigital'
            })
          ]
        );
      }

      return {
        order,
        dwigitalOrder,
        duplicate:false
      };
    });
  }catch(error){
    if(
      error?.code==='23505'&&
      error?.constraint==='orders_idempotency_key_key'
    ){
      const existing=await findByIdempotency(userId,idempotencyKey);

      if(existing){
        return {
          order:existing,
          duplicate:true
        };
      }
    }

    throw error;
  }
}

async function findForOrder(orderId,userId){
  const result=await query(
    `SELECT
       orders.id AS order_id,
       orders.user_id,
       orders.order_number,
       orders.total,
       orders.payment_method,
       orders.status AS order_status,
       orders.paid_at,
       orders.created_at AS order_created_at,
       dwigital_orders.*
     FROM orders
     JOIN dwigital_orders ON dwigital_orders.order_id=orders.id
     WHERE orders.id=$1 AND orders.user_id=$2
     LIMIT 1`,
    [orderId,userId]
  );

  return result.rows[0]||null;
}

async function findByReference(reference,client){
  const sql=`SELECT orders.*,dwigital_orders.*
             FROM dwigital_orders
             JOIN orders ON orders.id=dwigital_orders.order_id
             WHERE dwigital_orders.supplier_reference=$1
             LIMIT 1`;
  const params=[reference];
  const result=client
    ? await client.query(sql,params)
    : await query(sql,params);

  return result.rows[0]||null;
}


async function claimForSubmission(orderId){
  return withTransaction(async(client)=>{
    const order=(await client.query(
      'SELECT * FROM orders WHERE id=$1 FOR UPDATE',
      [orderId]
    )).rows[0];

    if(!order)return null;

    const digital=(await client.query(
      'SELECT * FROM dwigital_orders WHERE order_id=$1 FOR UPDATE',
      [orderId]
    )).rows[0];

    if(!digital)return null;

    const orderStatus=String(order.status||'').toUpperCase();
    const paymentMethod=String(order.payment_method||'').toUpperCase();

    if(
      !['BALANCE','GATEWAY','LIVE'].includes(paymentMethod)||
      !['PAID','PROCESSING'].includes(orderStatus)
    ){
      return {
        claimed:false,
        order_id:order.id,
        order_status:orderStatus,
        supplier_status:digital.supplier_status
      };
    }

    const supplierStatus=String(digital.supplier_status||'').toLowerCase();
    const submissionState=String(digital.submission_state||'').toLowerCase();

    if(
      ['pending','processing','partial','success','failed'].includes(supplierStatus)
    ){
      return {
        claimed:false,
        order_id:order.id,
        order_status:orderStatus,
        supplier_status:supplierStatus
      };
    }

    const leaseAge=digital.submission_started_at
      ? Date.now()-new Date(digital.submission_started_at).getTime()
      : Number.POSITIVE_INFINITY;

    if(
      submissionState==='submitting'&&
      Number.isFinite(leaseAge)&&
      leaseAge<120000
    ){
      return {
        claimed:false,
        order_id:order.id,
        order_status:orderStatus,
        supplier_status:supplierStatus
      };
    }

    if(!['not_submitted','unknown','submitting'].includes(submissionState)){
      return {
        claimed:false,
        order_id:order.id,
        order_status:orderStatus,
        supplier_status:supplierStatus
      };
    }

    await client.query(
      `UPDATE dwigital_orders
       SET submission_state='submitting',
           submission_started_at=now(),
           last_error_code=NULL,
           updated_at=now()
       WHERE order_id=$1`,
      [orderId]
    );

    if(orderStatus==='PAID'){
      await client.query(
        `UPDATE orders
         SET status='PROCESSING',
             updated_at=now()
         WHERE id=$1 AND status='PAID'`,
        [orderId]
      );
    }

    return {
      ...digital,
      order_id:order.id,
      user_id:order.user_id,
      order_number:order.order_number,
      order_status:'PROCESSING',
      payment_method:paymentMethod,
      claimed:true,
      submission_state:'submitting'
    };
  });
}

async function setSubmissionUnknown(orderId,errorCode){
  const result=await query(
    `UPDATE dwigital_orders
     SET submission_state='unknown',
         last_error_code=$2,
         updated_at=now()
     WHERE order_id=$1
       AND submission_state='submitting'`,
    [
      orderId,
      String(errorCode||'DWIGITAL_SUBMISSION_UNKNOWN').slice(0,96)
    ]
  );

  return result.rowCount>0;
}

async function applySupplierSnapshot(
  orderId,
  snapshot,
  {eventKey=null,eventName='order.updated',onRefund=null}={}
){
  const status=String(snapshot?.status||'').trim().toLowerCase();

  if(!['pending','processing','success','partial','failed'].includes(status)){
    throw repositoryError(
      'DWIGITAL_SUPPLIER_STATUS_INVALID',
      'Status pesanan dari supplier tidak valid.',
      502
    );
  }

  if(
    eventKey!==null&&
    !/^[a-f0-9]{64}$/.test(String(eventKey))
  ){
    throw repositoryError(
      'DWIGITAL_WEBHOOK_EVENT_INVALID',
      'Identitas webhook Dwigital tidak valid.'
    );
  }

  return withTransaction(async(client)=>{
    let eventRecorded=false;

    if(eventKey){
      const inserted=await client.query(
        `INSERT INTO dwigital_webhook_events(
           event_key,supplier_reference,event_name,supplier_status
         )
         VALUES($1,$2,$3,$4)
         ON CONFLICT(event_key) DO NOTHING
         RETURNING event_key`,
        [
          eventKey,
          String(snapshot.reference||''),
          String(eventName||'order.updated').slice(0,64),
          status
        ]
      );

      if(!inserted.rowCount){
        return {duplicate:true,updated:false};
      }

      eventRecorded=true;
    }

    const locked=(await client.query(
      `SELECT
         o.id AS order_id,
         o.user_id,
         o.order_number,
         o.payment_method,
         o.status AS order_status,
         o.total,
         d.*
       FROM orders o
       JOIN dwigital_orders d ON d.order_id=o.id
       WHERE o.id=$1
       FOR UPDATE OF o,d`,
      [orderId]
    )).rows[0];

    if(!locked){
      if(eventRecorded){
        await client.query(
          'UPDATE dwigital_webhook_events SET processed_at=now() WHERE event_key=$1',
          [eventKey]
        );
      }

      return {ignored:true,updated:false};
    }

    const previousStatus=String(locked.supplier_status||'').toLowerCase();
    const previousRefunded=locked.supplier_refunded===true;

    const staleSuccess=previousStatus==='success'&&status!=='success';
    const staleRefund=previousStatus==='failed'&&previousRefunded&&status!=='failed';

    if(staleSuccess||staleRefund){
      if(eventRecorded){
        await client.query(
          'UPDATE dwigital_webhook_events SET processed_at=now() WHERE event_key=$1',
          [eventKey]
        );
      }

      return {
        duplicate:false,
        ignored:true,
        updated:false,
        supplier_status:previousStatus
      };
    }

    const supplierRefunded=
      previousRefunded||snapshot.refunded===true;

    const hasNote=Object.prototype.hasOwnProperty.call(
      snapshot,'supplier_note_encrypted'
    );
    const hasAccounts=Object.prototype.hasOwnProperty.call(
      snapshot,'supplier_accounts_encrypted'
    );

    const updatedDigital=(await client.query(
      `UPDATE dwigital_orders
       SET supplier_ref_id=COALESCE($2,supplier_ref_id),
           supplier_status=$3,
           supplier_refunded=$4,
           supplier_note_encrypted=
             CASE WHEN $5::boolean THEN $6 ELSE supplier_note_encrypted END,
           supplier_accounts_encrypted=
             CASE WHEN $7::boolean THEN $8 ELSE supplier_accounts_encrypted END,
           submission_state='submitted',
           submitted_at=COALESCE(submitted_at,now()),
           last_polled_at=now(),
           supplier_updated_at=now(),
           last_error_code=NULL,
           updated_at=now()
       WHERE order_id=$1
       RETURNING *`,
      [
        orderId,
        snapshot.ref_id?String(snapshot.ref_id).slice(0,128):null,
        status,
        supplierRefunded,
        hasNote,
        hasNote?snapshot.supplier_note_encrypted:null,
        hasAccounts,
        hasAccounts?snapshot.supplier_accounts_encrypted:null
      ]
    )).rows[0];

    await client.query(
      `UPDATE orders
       SET status=CASE
             WHEN $2='success' THEN 'COMPLETED'::order_status
             ELSE 'PROCESSING'::order_status
           END,
           completed_at=CASE
             WHEN $2='success' THEN COALESCE(completed_at,now())
             ELSE completed_at
           END,
           updated_at=now()
       WHERE id=$1
         AND status<>'REFUNDED'`,
      [orderId,status]
    );

    if(
      typeof onRefund==='function'&&
      status==='failed'&&
      supplierRefunded
    ){
      await onRefund(client,{
        order:locked,
        dwigital:updatedDigital
      });
    }

    if(eventRecorded){
      await client.query(
        'UPDATE dwigital_webhook_events SET processed_at=now() WHERE event_key=$1',
        [eventKey]
      );
    }

    return {
      duplicate:false,
      updated:true,
      order_id:orderId,
      previous_status:previousStatus,
      supplier_status:status,
      supplier_refunded:supplierRefunded
    };
  });
}

async function listForReconciliation({limit=25}={}){
  const cap=Math.min(100,Math.max(1,Number(limit)||25));

  return (
    await query(
      `SELECT
         o.id AS order_id,
         o.user_id,
         o.order_number,
         o.status AS order_status,
         o.payment_method,
         d.supplier_reference,
         d.supplier_status,
         d.supplier_refunded,
         d.submission_state,
         d.submission_started_at,
         d.last_polled_at,
         d.target_encrypted,
         d.variant_id,
         d.max_price
       FROM orders o
       JOIN dwigital_orders d ON d.order_id=o.id
       WHERE o.status IN ('PAID','PROCESSING')
         AND (
           d.supplier_status='not_submitted'
           OR d.submission_state='unknown'
           OR (
             d.submission_state='submitting'
             AND COALESCE(d.submission_started_at,'epoch'::timestamptz)
                 < now()-interval '2 minutes'
           )
           OR (
             d.submission_state='submitted'
             AND d.supplier_status IN (
               'pending','processing','partial','failed'
             )
             AND COALESCE(
               d.last_polled_at,
               d.submitted_at,
               d.created_at
             ) < now()-interval '2 minutes'
           )
         )
       ORDER BY
         COALESCE(d.last_polled_at,d.updated_at,d.created_at) ASC
       LIMIT $1`,
      [cap]
    )
  ).rows;
}

async function markPollError(orderId,errorCode){
  const result=await query(
    `UPDATE dwigital_orders
     SET last_polled_at=now(),
         last_error_code=$2,
         updated_at=now()
     WHERE order_id=$1`,
    [
      orderId,
      String(errorCode||'DWIGITAL_STATUS_CHECK_FAILED').slice(0,96)
    ]
  );

  return result.rowCount>0;
}

module.exports={
  createPurchase,
  findByIdempotency,
  findForOrder,
  findByReference,
  claimForSubmission,
  setSubmissionUnknown,
  applySupplierSnapshot,
  listForReconciliation,
  markPollError
};
