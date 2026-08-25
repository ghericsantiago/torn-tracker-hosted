'use strict';
const db = require('../db');
const { BUY_TYPE_SET, SELL_TYPE_SET } = require('./log-types');

const TRADE_TYPES = new Set([4430,4440,4441,4445,4446]);
const CHANNELS = new Map([
  [1100,'item_market'],[1101,'item_market'],[1103,'item_market'],[1112,'item_market'],[1111,'item_market'],[1115,'item_market'],
  [1104,'item_market'],[1113,'item_market'],[1110,'item_market'],[1210,'bazaar'],[1211,'bazaar'],[1220,'bazaar'],[1225,'bazaar'],
  [1223,'bazaar'],[1224,'bazaar'],[1212,'bazaar'],[1221,'bazaar'],[1226,'bazaar'],[1500,'shop'],[1501,'shop'],
  [4200,'shop'],[4201,'abroad'],[4210,'shop'],[4220,'shop'],[4320,'auction'],[4322,'auction']
]);

function extractItems(data={}) {
  const raw = Array.isArray(data.items) ? data.items : Array.isArray(data.item) ? data.item : data.item != null ? [{id:data.item,qty:data.quantity}] : [];
  return raw.map(x=>({itemId:Number(x.id??x.ID),qty:Number(x.qty??x.quantity??1)||1})).filter(x=>x.itemId&&x.qty>0);
}
function total(data={}) { return Number(data.cost_total ?? data.cost ?? data.price ?? data.value ?? 0) || 0; }
function tradeId(data={}) { return data.parsed_trade_id != null ? String(data.parsed_trade_id) : null; }
function allocate(items, amount, prices) {
  const weight=items.reduce((s,x)=>s+x.qty*(prices.get(x.itemId)||0),0);
  let used=0;
  return items.map((x,i)=>{const allocated=i===items.length-1?amount-used:(weight?Math.round(amount*x.qty*(prices.get(x.itemId)||0)/weight):Math.round(amount/items.length));used+=allocated;return {...x,total:allocated};});
}

async function rebuildTradingProfit() {
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(82734191)');
    const types=[...BUY_TYPE_SET,...SELL_TYPE_SET,...TRADE_TYPES];
    const {rows:logs}=await client.query('SELECT id,log_type,happened_at,data FROM torn_logs WHERE log_type=ANY($1) ORDER BY happened_at,id',[types]);
    const {rows:catalog}=await client.query('SELECT id,market_price FROM torn_items');
    const prices=new Map(catalog.map(x=>[Number(x.id),Number(x.market_price)||0]));
    const {rows:receipts}=await client.query("SELECT trade_id,items FROM trade_receipts WHERE status='completed'");
    const receiptCosts=new Map();
    for(const receipt of receipts)for(const item of (receipt.items||[])){
      const id=Number(item.torn_item_id),unit=Number(item.effective_price);
      if(id&&Number.isFinite(unit))receiptCosts.set(`${receipt.trade_id}:${id}`,unit);
    }
    const events=[], trades=new Map();
    for(const log of logs){
      const d=log.data||{}, tid=tradeId(d);
      if(TRADE_TYPES.has(log.log_type)){
        if(!tid) continue;
        if(!trades.has(tid)) trades.set(tid,{id:tid,at:log.happened_at,in:[],out:[],paid:0,received:0});
        const t=trades.get(tid); if(log.happened_at>t.at)t.at=log.happened_at;
        if(log.log_type===4440)t.paid+=Number(d.money)||0;
        if(log.log_type===4441)t.received+=Number(d.money)||0;
        if(log.log_type===4445)t.out.push(...extractItems(d));
        if(log.log_type===4446)t.in.push(...extractItems(d));
        continue;
      }
      const side=BUY_TYPE_SET.has(log.log_type)?'buy':SELL_TYPE_SET.has(log.log_type)?'sell':null;
      if(!side)continue; const its=extractItems(d), amount=total(d);
      const allocated=allocate(its,amount,prices);
      allocated.forEach((x,i)=>events.push({key:`log:${log.id}:${x.itemId}:${i}`,at:log.happened_at,logId:log.id,tradeId:null,type:log.log_type,channel:CHANNELS.get(log.log_type)||'other',side,itemId:x.itemId,qty:x.qty,total:x.total}));
    }
    for(const t of trades.values()){
      const receiptPriced=t.in.map(x=>{const unit=receiptCosts.get(`${t.id}:${x.itemId}`);return unit==null?null:{...x,total:unit*x.qty}});
      const incoming=receiptPriced.every(Boolean)?receiptPriced:allocate(t.in,t.paid,prices);
      incoming.forEach((x,i)=>events.push({key:`trade:${t.id}:buy:${x.itemId}:${i}`,at:t.at,tradeId:t.id,type:4446,channel:'trade',side:'buy',itemId:x.itemId,qty:x.qty,total:x.total}));
      allocate(t.out,t.received,prices).forEach((x,i)=>events.push({key:`trade:${t.id}:sell:${x.itemId}:${i}`,at:t.at,tradeId:t.id,type:4445,channel:'trade',side:'sell',itemId:x.itemId,qty:x.qty,total:x.total}));
    }
    events.sort((a,b)=>new Date(a.at)-new Date(b.at)||a.key.localeCompare(b.key));
    await client.query('TRUNCATE trading_fifo_matches, trading_fifo_lots, trading_events RESTART IDENTITY CASCADE');
    const payload=events.map(e=>({source_key:e.key,happened_at:e.at,log_id:e.logId||null,trade_id:e.tradeId||null,log_type:e.type,channel:e.channel,side:e.side,item_id:e.itemId,qty:e.qty,unit_price:e.qty?e.total/e.qty:0,total_price:e.total}));
    const {rows:eventRows}=await client.query(`INSERT INTO trading_events(source_key,happened_at,log_id,trade_id,log_type,channel,side,item_id,qty,unit_price,total_price)
      SELECT source_key,happened_at,log_id,trade_id,log_type,channel,side,item_id,qty,unit_price,total_price FROM jsonb_to_recordset($1::jsonb)
      AS x(source_key text,happened_at timestamptz,log_id text,trade_id text,log_type int,channel text,side text,item_id int,qty int,unit_price numeric,total_price numeric) RETURNING id,source_key`,[JSON.stringify(payload)]);
    const eventIds=new Map(eventRows.map(x=>[x.source_key,Number(x.id)])), queues=new Map(), lotData=[], matchData=[], unmatched=[];
    for(const e of payload){
      if(!queues.has(e.item_id))queues.set(e.item_id,[]);const queue=queues.get(e.item_id);
      if(e.side==='buy'){const lot={event_id:eventIds.get(e.source_key),item_id:e.item_id,acquired_at:e.happened_at,qty_original:e.qty,qty_remaining:e.qty,unit_cost:e.unit_price};queue.push(lot);lotData.push(lot);continue;}
      let left=e.qty;
      for(const lot of queue){if(!left)break;if(!lot.qty_remaining)continue;const take=Math.min(left,lot.qty_remaining);matchData.push({sale_event_id:eventIds.get(e.source_key),lot_event_id:lot.event_id,qty:take,unit_cost:lot.unit_cost,unit_revenue:e.unit_price,realized_profit:(e.unit_price-lot.unit_cost)*take});lot.qty_remaining-=take;left-=take;}
      if(left)unmatched.push({id:eventIds.get(e.source_key),qty:left});
    }
    if(lotData.length){const {rows:lotRows}=await client.query(`INSERT INTO trading_fifo_lots(event_id,item_id,acquired_at,qty_original,qty_remaining,unit_cost)
      SELECT event_id,item_id,acquired_at,qty_original,qty_remaining,unit_cost FROM jsonb_to_recordset($1::jsonb)
      AS x(event_id bigint,item_id int,acquired_at timestamptz,qty_original int,qty_remaining int,unit_cost numeric) RETURNING id,event_id`,[JSON.stringify(lotData)]);const lotIds=new Map(lotRows.map(x=>[Number(x.event_id),Number(x.id)]));
      if(matchData.length)await client.query(`INSERT INTO trading_fifo_matches(sale_event_id,lot_id,qty,unit_cost,unit_revenue,realized_profit)
        SELECT sale_event_id,lot_id,qty,unit_cost,unit_revenue,realized_profit FROM jsonb_to_recordset($1::jsonb)
        AS x(sale_event_id bigint,lot_id bigint,qty int,unit_cost numeric,unit_revenue numeric,realized_profit numeric)`,[JSON.stringify(matchData.map(x=>({...x,lot_id:lotIds.get(x.lot_event_id)})))]);
    }
    if(unmatched.length)await client.query(`UPDATE trading_events e SET unmatched_qty=x.qty FROM jsonb_to_recordset($1::jsonb) AS x(id bigint,qty int) WHERE e.id=x.id`,[JSON.stringify(unmatched)]);
    await client.query('COMMIT');
    return {events:events.length,trades:trades.size};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
module.exports={rebuildTradingProfit};
