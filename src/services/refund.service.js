const { withTransaction }=require('../config/database');
const delivery=require('../repositories/delivery.repository');
const walletRepository=require('../repositories/wallet.repository');
const notifications=require('./notification/notification.service');
async function refund(ownerId, orderId, reason){
  if(!reason || String(reason).trim().length<5) throw Object.assign(new Error('Alasan refund wajib diisi.'),{status:400,code:'REFUND_REASON_REQUIRED',expose:true});
  return withTransaction(async(client)=>{
    const order=(await client.query('select * from orders where id=$1 for update',[orderId])).rows[0];
    if(!order) throw Object.assign(new Error('Order tidak ditemukan.'),{status:404,code:'ORDER_NOT_FOUND',expose:true});
    if(order.payment_method!=='BALANCE') throw Object.assign(new Error('Refund otomatis untuk payment gateway belum tersedia tanpa adapter refund resmi dari provider.'),{status:409,code:'REFUND_PROVIDER_UNSUPPORTED',expose:true});
    if(!['PAID','COMPLETED','PROCESSING'].includes(order.status)) throw Object.assign(new Error('Order belum berada pada status yang dapat direfund.'),{status:409,code:'ORDER_NOT_REFUNDABLE',expose:true});
    if((await client.query("select id from refunds where order_id=$1 and status='COMPLETED'",[orderId])).rows[0]) throw Object.assign(new Error('Order sudah pernah direfund.'),{status:409,code:'ALREADY_REFUNDED',expose:true});
    const wallet=(await client.query('select * from wallets where user_id=$1 for update',[order.user_id])).rows[0] || (await client.query('insert into wallets(user_id) values($1) returning *',[order.user_id])).rows[0];
    const before=Number(wallet.balance), after=before+Number(order.total);
    const refundRow=(await client.query("insert into refunds(order_id,payment_id,user_id,amount,reason,status,created_by) values($1,null,$2,$3,$4,'COMPLETED',$5) returning *",[order.id,order.user_id,order.total,reason,ownerId])).rows[0];
    await client.query('update wallets set balance=$2,updated_at=now() where user_id=$1',[order.user_id,after]);
    await client.query("insert into wallet_transactions(wallet_id,user_id,type,amount,balance_before,balance_after,reference,status,reason,metadata) values($1,$2,'REFUND',$3,$4,$5,$6,'COMPLETED',$7,$8)",[wallet.id,order.user_id,order.total,before,after,order.order_number,reason,JSON.stringify({refundId:refundRow.id,orderId:order.id})]);
    await client.query("update orders set status='REFUNDED',updated_at=now() where id=$1",[order.id]);
    await delivery.revokeByOrder(order.id,client);
    await notifications.notify(order.user_id,{type:'PAYMENT',title:'Refund berhasil',body:`Order ${order.order_number} telah direfund ke saldo wallet.`,link:`/orders/${order.id}`},client);
    await client.query("insert into activity_logs(actor_user_id,action,entity_type,entity_id,metadata) values($1,'REFUND_ORDER','order',$2,$3)",[ownerId,order.id,JSON.stringify({amount:order.total,reason})]);
    return refundRow;
  });
}

async function refundDwigitalOrder(orderId,reason,client){
  const run=async(transaction)=>{
    const order=(await transaction.query(
      'SELECT * FROM orders WHERE id=$1 FOR UPDATE',
      [orderId]
    )).rows[0];

    if(!order){
      throw Object.assign(
        new Error('Order Dwigital tidak ditemukan.'),
        {status:404,code:'ORDER_NOT_FOUND',expose:true}
      );
    }

    const digital=(await transaction.query(
      'SELECT * FROM dwigital_orders WHERE order_id=$1 FOR UPDATE',
      [orderId]
    )).rows[0];

    const submissionRejected=
      String(digital?.submission_state||'').toLowerCase()==='rejected';

    if(
      !digital||
      String(digital.supplier_status||'').toLowerCase()!=='failed'||
      (digital.supplier_refunded!==true&&!submissionRejected)
    ){
      throw Object.assign(
        new Error('Refund supplier belum dikonfirmasi.'),
        {status:409,code:'DWIGITAL_SUPPLIER_REFUND_NOT_CONFIRMED',expose:true}
      );
    }

    const existing=(await transaction.query(
      `SELECT *
       FROM refunds
       WHERE order_id=$1 AND status='COMPLETED'
       LIMIT 1`,
      [orderId]
    )).rows[0];

    if(existing){
      if(order.status!=='REFUNDED'){
        await transaction.query(
          "UPDATE orders SET status='REFUNDED',updated_at=now() WHERE id=$1",
          [orderId]
        );
      }

      return existing;
    }

    const amount=Number(order.total);

    if(!Number.isSafeInteger(amount)||amount<=0){
      throw Object.assign(
        new Error('Nominal refund Dwigital tidak valid.'),
        {status:409,code:'DWIGITAL_REFUND_AMOUNT_INVALID',expose:true}
      );
    }

    const refundReason=String(
      reason||'Pesanan supplier gagal; dana dikembalikan ke Wallet JYYR.'
    ).trim().slice(0,500);

    await walletRepository.ensure(transaction,order.user_id);

    const wallet=(await transaction.query(
      'SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE',
      [order.user_id]
    )).rows[0];

    if(!wallet){
      throw Object.assign(
        new Error('Wallet JYYR tidak tersedia.'),
        {status:500,code:'WALLET_NOT_AVAILABLE'}
      );
    }

    const before=Number(wallet.balance);
    const after=before+amount;

    if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after)){
      throw Object.assign(
        new Error('Saldo Wallet JYYR tidak valid untuk refund.'),
        {status:409,code:'WALLET_BALANCE_INVALID',expose:true}
      );
    }

    const refundRow=(await transaction.query(
      `INSERT INTO refunds(
         order_id,payment_id,user_id,amount,reason,status,created_by
       )
       VALUES($1,NULL,$2,$3,$4,'COMPLETED',NULL)
       RETURNING *`,
      [order.id,order.user_id,amount,refundReason]
    )).rows[0];

    await transaction.query(
      'UPDATE wallets SET balance=$2,updated_at=now() WHERE user_id=$1',
      [order.user_id,after]
    );

    await transaction.query(
      `INSERT INTO wallet_transactions(
         wallet_id,user_id,type,amount,balance_before,balance_after,
         reference,status,reason,metadata
       )
       VALUES(
         $1,$2,'REFUND',$3,$4,$5,$6,'COMPLETED',$7,$8::jsonb
       )`,
      [
        wallet.id,
        order.user_id,
        amount,
        before,
        after,
        order.order_number,
        refundReason,
        JSON.stringify({
          refundId:refundRow.id,
          orderId:order.id,
          provider:'dwigital',
          source:submissionRejected?'provider_rejection':'supplier_refund'
        })
      ]
    );

    await transaction.query(
      "UPDATE orders SET status='REFUNDED',updated_at=now() WHERE id=$1",
      [order.id]
    );

    await delivery.revokeByOrder(order.id,transaction);

    await notifications.notify(
      order.user_id,
      {
        type:'PAYMENT',
        title:'Refund berhasil',
        body:`Order ${order.order_number} gagal diproses supplier. ${require('../utils/currency').formatIDR(amount)} telah dikreditkan ke Wallet JYYR.`,
        link:`/orders/${order.id}`
      },
      transaction
    );

    return refundRow;
  };

  return client ? run(client) : withTransaction(run);
}

module.exports={refund,refundDwigitalOrder};
