import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

// This server is deliberately a demo API. It has no real authentication, PostgreSQL,
// payment rails, payout capability, or authoritative financial balances.
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const demoOnly = true;
app.disable('x-powered-by');
app.use((_req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Cache-Control','no-store');next();});
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '24kb', type:'application/json' }));

const bucket = new Map();
app.use((req,res,next)=>{
  const now=Date.now(), key=req.ip || 'local'; const current=bucket.get(key);
  if(!current||now-current.start>60_000){bucket.set(key,{start:now,count:1});return next();}
  current.count++; if(current.count>100)return res.status(429).json({error:'Too many demo requests. Try again shortly.'}); next();
});
const events=[]; const deposits=[]; const withdrawals=[]; const tickets=[]; const wallets=[];
const orders=[
  { id:'PP-D-2401',kind:'SELL',seller:'Suresh',method:'MobiKwik',amountPaise:10000,currency:'INR',status:'AVAILABLE',expiresInMinutes:12 },
  { id:'PP-D-2402',kind:'BUY',seller:'PaisaPay Demo',method:'Paytm',amountPaise:25000,currency:'INR',status:'AVAILABLE',expiresInMinutes:18 },
  { id:'PP-D-2403',kind:'SELL',seller:'Ravi',method:'PhonePe',amountPaise:50000,currency:'INR',status:'AVAILABLE',expiresInMinutes:22 },
  { id:'PP-D-2404',kind:'SELL',seller:'Anita',method:'Navi',amountPaise:20000,currency:'INR',status:'AVAILABLE',expiresInMinutes:8 },
];
const methods={MobiKwik:{buy:true,sell:true},Paytm:{buy:true,sell:true},PhonePe:{buy:false,sell:true},Navi:{buy:false,sell:true}};
const id=prefix=>`${prefix}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
const addEvent=(type,detail)=>events.unshift({id:crypto.randomUUID(),type,detail,at:new Date().toISOString(),demoOnly:true});
const amount=(v)=>Number.isSafeInteger(v)&&v>0&&v<=100_000_000;

app.get('/health',(_req,res)=>res.json({ok:true,app:'PaisaPay Demo API',demoOnly,financialFeatures:'disabled'}));
app.get('/v1/config',(_req,res)=>res.json({currency:'INR',demoOnly,realPaymentsEnabled:false,authentication:'demo-only',paymentMethods:methods,features:{deposits:'demo-request-only',withdrawals:'demo-request-only',walletConnection:'unavailable',paymentVerification:'unavailable'}}));
app.post('/v1/demo/session',(req,res)=>{
  const phone=String(req.body?.phone||'').replace(/\D/g,'');
  if(phone.length!==10)return res.status(400).json({error:'Enter a 10-digit Indian mobile number.'});
  const session={id:crypto.randomUUID(),phone:`******${phone.slice(-4)}`,demoOnly:true,note:'No OTP was sent; this is not an authenticated production session.'};
  addEvent('DEMO_SESSION_CREATED',session.phone);res.json(session);
});
app.get('/v1/demo/wallet',(_req,res)=>res.json({currency:'INR',availablePaise:100000,reservedPaise:0,pendingWithdrawalPaise:0,demoOnly:true,authoritative:false}));
app.get('/v1/orders',(req,res)=>{const kind=String(req.query.kind||'').toUpperCase();const rows=orders.filter(o=>(!kind||o.kind===kind)&&(o.kind!=='BUY'||methods[o.method]?.buy));res.json({currency:'INR',demoOnly:true,orders:rows});});
app.post('/v1/orders',(req,res)=>{
  const {amountPaise:paise,method,seller='Demo User'}=req.body||{};
  if(!amount(paise)||paise<1000)return res.status(400).json({error:'Order amount must be at least ₹10.'});
  if(!methods[method]?.sell)return res.status(400).json({error:'This payment method is not enabled for demo Sell orders.'});
  const order={id:id('PP-D'),kind:'SELL',seller:String(seller).slice(0,60),method,amountPaise:paise,currency:'INR',status:'AVAILABLE',expiresInMinutes:30,createdAt:new Date().toISOString(),demoOnly:true};
  orders.unshift(order);addEvent('DEMO_SELL_ORDER_CREATED',order.id);res.status(201).json({order,note:'Demo listing only. No payment destination is connected.',demoOnly:true});
});
app.get('/v1/orders/:orderId',(req,res)=>{const order=orders.find(o=>o.id===req.params.orderId);return order?res.json({demoOnly:true,order}):res.status(404).json({error:'Order not found'});});
app.post('/v1/orders/:orderId/reservations',(req,res)=>{
  const order=orders.find(o=>o.id===req.params.orderId);if(!order)return res.status(404).json({error:'Order not found'});
  const key=String(req.get('Idempotency-Key')||'');if(key.length<8||key.length>120)return res.status(400).json({error:'A demo Idempotency-Key of 8 to 120 characters is required.'});
  const prior=events.find(x=>x.idempotencyKey===key);if(prior)return res.json({message:'Idempotent demo response.',order:orders.find(o=>o.id===prior.orderId),demoOnly:true});
  if(order.status!=='AVAILABLE')return res.status(409).json({error:'Order is no longer available.'});
  order.status='RESERVED';order.reservationId=id('RSV');order.reservedAt=new Date().toISOString();
  events.unshift({id:crypto.randomUUID(),type:'DEMO_ORDER_RESERVED',orderId:order.id,idempotencyKey:key,at:new Date().toISOString(),demoOnly:true});
  res.json({message:'Demo reservation created. No payment occurred.',order,demoOnly:true});
});
app.post('/v1/deposits',(req,res)=>{
  const {amountPaise:paise,method}=req.body||{};if(!amount(paise)||paise<1000)return res.status(400).json({error:'Amount must be at least 1,000 paise (₹10).'});
  if(!methods[method])return res.status(400).json({error:'Select a supported demo payment method.'});
  const key=String(req.get('Idempotency-Key')||'');if(key.length<8)return res.status(400).json({error:'Idempotency-Key is required.'});
  const prior=deposits.find(x=>x.idempotencyKey===key);if(prior)return res.json({deposit:prior,demoOnly:true});
  const d={id:id('PP-DEP'),amountPaise:paise,currency:'INR',method,status:'PAYMENT_PENDING',idempotencyKey:key,createdAt:new Date().toISOString(),demoOnly:true};deposits.unshift(d);addEvent('DEMO_DEPOSIT_REQUESTED',d.id);res.status(201).json({deposit:d,note:'No payment was initiated and no balance was credited.',demoOnly:true});
});
app.get('/v1/deposits',(_req,res)=>res.json({demoOnly:true,deposits}));
app.post('/v1/withdrawals',(req,res)=>{
  const paise=req.body?.amountPaise;if(!amount(paise)||paise<10000)return res.status(400).json({error:'Amount must be at least ₹100.'});
  const key=String(req.get('Idempotency-Key')||'');if(key.length<8)return res.status(400).json({error:'Idempotency-Key is required.'});
  const prior=withdrawals.find(x=>x.idempotencyKey===key);if(prior)return res.json({withdrawal:prior,demoOnly:true});
  const w={id:id('PP-WD'),amountPaise:paise,currency:'INR',status:'UNDER_REVIEW',idempotencyKey:key,createdAt:new Date().toISOString(),demoOnly:true};withdrawals.unshift(w);addEvent('DEMO_WITHDRAWAL_REQUESTED',w.id);res.status(201).json({withdrawal:w,note:'No balance was reserved and no payout was sent.',demoOnly:true});
});
app.get('/v1/withdrawals',(_req,res)=>res.json({demoOnly:true,withdrawals}));
app.post('/v1/wallet-references',(req,res)=>{
  const {method,reference}=req.body||{};if(!methods[method])return res.status(400).json({error:'Unknown payment method.'});
  if(typeof reference!=='string'||reference.length>120||!/^[-\w.]+@[-\w.]+$/.test(reference))return res.status(400).json({error:'Enter a valid UPI ID reference.'});
  const w={id:id('REF'),method,reference,status:'REFERENCE_SAVED_NOT_CONNECTED',createdAt:new Date().toISOString(),demoOnly:true};wallets.unshift(w);addEvent('DEMO_WALLET_REFERENCE_SAVED',w.id);res.status(201).json({wallet:w,note:'This reference does not connect an account or grant transaction access.',demoOnly:true});
});
app.get('/v1/wallet-references',(_req,res)=>res.json({demoOnly:true,wallets}));
app.post('/v1/support/tickets',(req,res)=>{const subject=String(req.body?.subject||'').trim(),message=String(req.body?.message||'').trim();if(!subject||subject.length>100||!message||message.length>2000)return res.status(400).json({error:'Subject (1-100 chars) and message (1-2,000 chars) are required.'});const t={id:id('PP-T'),subject,message,status:'OPEN',createdAt:new Date().toISOString(),demoOnly:true};tickets.unshift(t);addEvent('DEMO_SUPPORT_TICKET_CREATED',t.id);res.status(201).json({ticket:t,demoOnly:true});});
app.get('/v1/support/tickets',(_req,res)=>res.json({demoOnly:true,tickets:tickets.map(({message,...t})=>t)}));
app.get('/v1/demo/activity',(_req,res)=>res.json({demoOnly:true,events:events.map(({idempotencyKey,...event})=>event)}));
app.use((_req,res)=>res.status(404).json({error:'Route not found'}));
app.use((err,_req,res,_next)=>{console.error('Request error:',err?.message||'unknown');res.status(400).json({error:'Invalid request.'});});
app.listen(PORT,HOST,()=>console.log(`PaisaPay demo API listening on http://${HOST}:${PORT} (demo only)`));
