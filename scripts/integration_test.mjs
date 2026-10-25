import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {writeCSV} from '../src/csv.mjs';
const url=process.env.N8N_WEBHOOK_URL??'http://127.0.0.1:8788/api/action';
const key=process.env.N8N_AUTH_TOKEN??'',results=[];
const base={mode:'demo',as_of:'2026-07-31T09:00:00+07:00'};
async function call(input,authenticate=true){
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(authenticate&&key?{'X-Planner-Key':key}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(45000)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{if(response.status===403&&!authenticate)data={ok:false,error:{code:'unauthenticated'}};else throw Error(`Non-JSON response HTTP ${response.status}: ${text.slice(0,150)}`);}
 return {status:response.status,body:data};
}
async function check(id,input,expected,project){
 try{const r=await call(input),actual=project(r);assert.deepEqual(actual,expected);results.push({id,input:JSON.stringify(input),expected:JSON.stringify(expected),actual:JSON.stringify(actual),result:'PASS'});console.log(id,'PASS');return r.body;}
 catch(e){results.push({id,input:JSON.stringify(input),expected:JSON.stringify(expected),actual:e.message,result:'FAIL'});console.log(id,'FAIL',e.message);throw e;}
}
try{
 await check('I01 evaluate real data',{action:'evaluate',...base},{total:82,needs_replenishment:28,sufficient:49,review:5},r=>r.body.result.summary);
 await check('I02 missing policy',{action:'evaluate',product_id:'SKU-0003',...base},'review',r=>r.body.result.rows[0].state);
 await check('I03 unknown product',{action:'evaluate',product_id:'SKU-9999',...base},404,r=>r.status);
 await check('I04 stale data blocks',{action:'evaluate',mode:'demo',as_of:'2026-08-02T09:00:00+07:00'},82,r=>r.body.result.summary.review);
 await check('I05 zero rejected',{action:'create',quantity:0,actor:'ผู้ทดสอบ'},422,r=>r.status);
 const create={action:'create',product_id:'SKU-0011',quantity:21,actor:'ผู้ทดสอบระบบ',reason:'ทดสอบการเชื่อมระบบ',idempotency_key:randomUUID(),...base};
 const created=await check('I06 create and verify readback',create,{status:201,qty:21,verified:true},r=>({status:r.status,qty:Number(r.body.result.request.quantity),verified:r.body.result.readback_verified}));
 const id=created.result.request.request_id;
 await check('I07 retrieve persisted row',{action:'get',request_id:id},21,r=>Number(r.body.result.request.quantity));
 await check('I08 replay does not duplicate',create,true,r=>r.body.result.replayed);
 const update={action:'update',request_id:id,revision:1,quantity:20,status:'submitted',actor:'ผู้ทดสอบระบบ',reason:'ปรับตามพื้นที่จัดเก็บ',...base};
 await check('I09 update and verify readback',update,{quantity:20,revision:2,status:'submitted',verified:true},r=>({quantity:Number(r.body.result.request.quantity),revision:Number(r.body.result.request.revision),status:r.body.result.request.status,verified:r.body.result.readback_verified}));
 await check('I10 stale revision rejected',update,409,r=>r.status);
 await check('I11 duplicate product prevented',{...create,idempotency_key:randomUUID()},409,r=>r.status);
 await check('I12 cancel keeps history',{...update,revision:2,status:'cancelled',reason:'จบกรณีทดสอบ'},'cancelled',r=>r.body.result.request.status);
 await check('I13 saved edit still retrievable',{action:'get',request_id:id},20,r=>Number(r.body.result.request.quantity));
 if(key){const r=await call({action:'evaluate'},false);assert.equal(r.status,403);results.push({id:'I14 unauthenticated request blocked',input:'no authentication header',expected:'403',actual:String(r.status),result:'PASS'});}
}catch(e){process.exitCode=1;console.error(e.message);}
finally{
 const name=process.env.RESULT_PREFIX??(url.includes('n8n.cloud')?'cloud':'local');
 fs.mkdirSync('tests/results',{recursive:true});
 fs.writeFileSync(`tests/results/${name}-integration.json`,JSON.stringify({tested_at:new Date().toISOString(),transport:url.includes('n8n.cloud')?'n8n Cloud + Google Sheets':'local HTTP + SQLite',results},null,2));
 writeCSV(`tests/results/${name}-integration.csv`,results);
 console.log(`${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);
}
