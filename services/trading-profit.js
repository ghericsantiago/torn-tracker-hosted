'use strict';

const db = require('../db');

async function enrichInventoryTradeLots(client) {
  const result = await client.query(`
    WITH receipt_prices AS (
      SELECT fl.id AS lot_id, fl.item_id, fl.ts, fl.total_qty,
             ROUND((j.item_data->>'effective_price')::numeric) AS unit_cost
      FROM fifo_lots fl
      JOIN trade_events te ON te.ts = fl.ts
      JOIN trade_receipts tr ON tr.trade_id::text = te.trade_id
      CROSS JOIN LATERAL jsonb_array_elements(tr.items) AS j(item_data)
      WHERE fl.source = 'Trade'
        AND (j.item_data->>'torn_item_id')::int::text = fl.item_id
        AND j.item_data->>'effective_price' IS NOT NULL
    ), updated AS (
      UPDATE fifo_lots fl SET unit_cost = rp.unit_cost
      FROM receipt_prices rp WHERE fl.id = rp.lot_id
      RETURNING fl.id
    )
    UPDATE transactions tx SET unit_price = rp.unit_cost,
      total_price = rp.unit_cost * rp.total_qty
    FROM receipt_prices rp
    WHERE tx.channel='trade' AND tx.side='buy'
      AND tx.item_id=rp.item_id AND tx.ts=rp.ts AND tx.log_id IS NULL
  `);
  return result.rowCount;
}

async function rebuildTradingProfit() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(82734191)');
    await enrichInventoryTradeLots(client);

    const [{ rows: inventoryLots }, { rows: outflows }] = await Promise.all([
      client.query(`SELECT fl.id,fl.ts,fl.item_id,fl.item_name,fl.item_category,fl.total_qty,
          fl.remaining_qty,fl.unit_cost,fl.source,fl.log_id,
          (SELECT te.trade_id FROM trade_events te WHERE te.ts=fl.ts LIMIT 1) trade_id
        FROM fifo_lots fl WHERE fl.item_id ~ '^[0-9]+$' ORDER BY fl.ts,fl.id`),
      client.query(`SELECT tx.id,tx.ts,tx.log_id,tx.log_type,tx.channel,tx.side,tx.item_id,
          tx.item_name,tx.item_category,tx.qty,COALESCE(tx.unit_price,0) unit_price,
          COALESCE(tx.total_price,0) total_price,
          CASE WHEN tx.channel='trade' THEN (SELECT te.trade_id FROM trade_events te WHERE te.ts=tx.ts LIMIT 1) END trade_id
        FROM transactions tx WHERE tx.side IN ('sell','use') AND tx.item_id ~ '^[0-9]+$' ORDER BY tx.ts,tx.id`),
    ]);

    const events = [];
    for (const lot of inventoryLots) events.push({
      key:`inventory-lot:${lot.id}`, at:new Date(Number(lot.ts)), logId:lot.log_id, tradeId:lot.trade_id,
      type:0, channel:String(lot.source||'inventory').toLowerCase().replaceAll(' ','_'), side:'buy',
      itemId:Number(lot.item_id), qty:Number(lot.total_qty), unit:Number(lot.unit_cost)||0,
      total:Number(lot.total_qty)*(Number(lot.unit_cost)||0), inventoryLotId:Number(lot.id),
      actualRemaining:Number(lot.remaining_qty), source:lot.source,
    });
    for (const tx of outflows) events.push({
      key:`inventory-tx:${tx.id}`, at:new Date(Number(tx.ts)), logId:tx.log_id, tradeId:tx.trade_id,
      type:Number(tx.log_type)||0, channel:tx.channel,
      side:tx.side==='sell'?'sell':tx.channel==='museum'?'museum':'use',
      itemId:Number(tx.item_id), qty:Number(tx.qty), unit:Number(tx.unit_price)||0,
      total:Number(tx.total_price)||0,
    });
    events.sort((a,b)=>a.at-b.at||a.key.localeCompare(b.key));

    await client.query('TRUNCATE trading_fifo_matches, trading_fifo_lots, trading_events RESTART IDENTITY CASCADE');
    const payload=events.map(e=>({source_key:e.key,happened_at:e.at,log_id:e.logId||null,trade_id:e.tradeId||null,log_type:e.type,channel:e.channel,side:e.side,item_id:e.itemId,qty:e.qty,unit_price:e.unit,total_price:e.total}));
    const {rows:eventRows}=await client.query(`INSERT INTO trading_events(source_key,happened_at,log_id,trade_id,log_type,channel,side,item_id,qty,unit_price,total_price)
      SELECT source_key,happened_at,log_id,trade_id,log_type,channel,side,item_id,qty,unit_price,total_price
      FROM jsonb_to_recordset($1::jsonb) AS x(source_key text,happened_at timestamptz,log_id text,trade_id text,log_type int,channel text,side text,item_id int,qty int,unit_price numeric,total_price numeric)
      RETURNING id,source_key`,[JSON.stringify(payload)]);
    const eventIds=new Map(eventRows.map(x=>[x.source_key,Number(x.id)]));

    const queues=new Map(), lotData=[], matchData=[], unmatched=[];
    for(const e of events){
      if(!queues.has(e.itemId))queues.set(e.itemId,[]);const queue=queues.get(e.itemId);
      if(e.inventoryLotId){const lot={event_id:eventIds.get(e.key),item_id:e.itemId,acquired_at:e.at,qty_original:e.qty,qty_remaining:e.qty,unit_cost:e.unit,actual_remaining:e.actualRemaining};queue.push(lot);lotData.push(lot);continue;}
      let left=e.qty;
      for(const lot of queue){if(!left)break;if(!lot.qty_remaining)continue;const take=Math.min(left,lot.qty_remaining);matchData.push({sale_event_id:eventIds.get(e.key),lot_event_id:lot.event_id,qty:take,unit_cost:lot.unit_cost,unit_revenue:e.side==='sell'?e.unit:0,realized_profit:e.side==='sell'?(e.unit-lot.unit_cost)*take:0});lot.qty_remaining-=take;left-=take;}
      if(left)unmatched.push({id:eventIds.get(e.key),qty:left});
    }
    // Inventory Monitor is canonical. Its persisted remainder wins over any gap in transaction history.
    for(const lot of lotData)lot.qty_remaining=lot.actual_remaining;
    if(lotData.length){
      const {rows:lotRows}=await client.query(`INSERT INTO trading_fifo_lots(event_id,item_id,acquired_at,qty_original,qty_remaining,unit_cost)
        SELECT event_id,item_id,acquired_at,qty_original,qty_remaining,unit_cost FROM jsonb_to_recordset($1::jsonb)
        AS x(event_id bigint,item_id int,acquired_at timestamptz,qty_original int,qty_remaining int,unit_cost numeric) RETURNING id,event_id`,[JSON.stringify(lotData)]);
      const lotIds=new Map(lotRows.map(x=>[Number(x.event_id),Number(x.id)]));
      if(matchData.length)await client.query(`INSERT INTO trading_fifo_matches(sale_event_id,lot_id,qty,unit_cost,unit_revenue,realized_profit)
        SELECT sale_event_id,lot_id,qty,unit_cost,unit_revenue,realized_profit FROM jsonb_to_recordset($1::jsonb)
        AS x(sale_event_id bigint,lot_id bigint,qty int,unit_cost numeric,unit_revenue numeric,realized_profit numeric)`,[JSON.stringify(matchData.map(x=>({...x,lot_id:lotIds.get(x.lot_event_id)}))) ]);
    }
    if(unmatched.length)await client.query(`UPDATE trading_events e SET unmatched_qty=x.qty FROM jsonb_to_recordset($1::jsonb) AS x(id bigint,qty int) WHERE e.id=x.id`,[JSON.stringify(unmatched)]);
    await client.query('COMMIT');
    return {events:events.length,lots:inventoryLots.length,outflows:outflows.length};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

module.exports={rebuildTradingProfit,enrichInventoryTradeLots};
