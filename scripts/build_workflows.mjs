import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {loadRaw} from './prepare_data.mjs';
import {REQUEST_FIELDS} from '../src/core.mjs';
const sheetId=process.env.PLANNER_SHEET_ID??'REPLACE_WITH_SPREADSHEET_ID';
const shared=fs.readFileSync('src/core.mjs','utf8').replace(/^export /gm,'');
const workflow=(name,id)=>({name,id,nodes:[],connections:{},active:false,settings:{executionOrder:'v1',saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveExecutionProgress:false},pinData:{},versionId:randomUUID(),tags:[]});
const add=(w,name,type,parameters,position,typeVersion=1,extra={})=>{w.nodes.push({id:randomUUID(),name,type,parameters,position,typeVersion,...extra});return name;};
const edge=(w,from,to,output=0)=>{w.connections[from]??={main:[]};w.connections[from].main[output]??=[];w.connections[from].main[output].push({node:to,type:'main',index:0});};
const reply=w=>add(w,'Respond','n8n-nodes-base.respondToWebhook',{respondWith:'json',responseBody:'={{ $json }}',options:{responseCode:'={{ $json.http_status || 200 }}'}},[1740,100],1.4);
const condition=(left,right)=>({conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:randomUUID(),leftValue:left,rightValue:right,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
const sheetBase=tab=>({resource:'sheet',documentId:{__rl:true,value:sheetId,mode:'id'},sheetName:{__rl:true,value:tab,mode:'name'},options:{}});
const failCode="return [{json:{ok:false,http_status:503,error:{code:'service_unavailable',message:'เชื่อมต่อแหล่งข้อมูลหรือบันทึกไม่สำเร็จ ยังยืนยันผลไม่ได้ กรุณาค้นหารายการก่อนลองใหม่'}}}];";
const w=workflow('BaanDee Stock Planner - Google Sheets','BaanDeeSheetsV1');
add(w,'Planner Webhook','n8n-nodes-base.webhook',{httpMethod:'POST',path:'baandee-stock-planner',authentication:'headerAuth',responseMode:'responseNode',options:{}},[0,100],2,{webhookId:randomUUID()});
let previous='Planner Webhook';
for(const [i,tab] of ['products','inventory','policies','requests'].entries()){
 const name=`Read ${tab}`;add(w,name,'n8n-nodes-base.googleSheets',{...sheetBase(tab),operation:'read'},[220+i*210,100],4.7,{alwaysOutputData:true,executeOnce:true,onError:'continueRegularOutput'});edge(w,previous,name);previous=name;
}
const planCode=shared+`\nconst rows=name=>$(name).all().map(i=>i.json);\nif(['Read products','Read inventory','Read policies','Read requests'].some(name=>rows(name).some(r=>r.error))) return [{json:{ok:false,http_status:503,error:{code:'source_unavailable',message:'อ่านแหล่งข้อมูลไม่สำเร็จ ยังไม่สร้างหรือแก้ไขใบเสนอ'}}}];\nconst raw={products:rows('Read products').filter(r=>r.product_id),inventory:rows('Read inventory').filter(r=>r.product_id),policies:rows('Read policies').filter(r=>r.product_id)};\nif(!raw.products.length||!raw.inventory.length) return [{json:{ok:false,http_status:503,error:{code:'empty_source',message:'แหล่งข้อมูลสินค้า/สต็อกว่าง กรุณาตรวจสอบ'}}}];\nconst data=prepareData(raw),existing=rows('Read requests').filter(r=>r.request_id);\nconst input=$('Planner Webhook').first().json.body??{};\nconst planned=safePlan(input,data,existing,new Date().toISOString(),'REQ-'+$execution.id+'-'+Date.now());\nreturn [{json:planned}];`;
add(w,'Validate and Plan','n8n-nodes-base.code',{jsCode:planCode},[1090,100],2);edge(w,previous,'Validate and Plan');
add(w,'Needs Write','n8n-nodes-base.if',condition('={{ !!$json.write }}',true),[1290,100],2.2);edge(w,'Validate and Plan','Needs Write');
reply(w);edge(w,'Needs Write','Respond',1);
add(w,'Write Row','n8n-nodes-base.code',{jsCode:"return [{json:$('Validate and Plan').first().json.write.row}];"},[1300,350],2);edge(w,'Needs Write','Write Row',0);
add(w,'Is New','n8n-nodes-base.if',condition("={{ $('Validate and Plan').first().json.write.type === 'append' }}",true),[1510,350],2.2);edge(w,'Write Row','Is New');
for(const [op,y]of [['append',300],['update',520]]){
 const name=op==='append'?'Create Proposal':'Update Proposal';
 add(w,name,'n8n-nodes-base.googleSheets',{...sheetBase('requests'),operation:op,columns:{mappingMode:'defineBelow',value:Object.fromEntries(REQUEST_FIELDS.map(k=>[k,`={{ $json.${k} }}`])),matchingColumns:op==='update'?['request_id']:[],schema:REQUEST_FIELDS.map(k=>({id:k,displayName:k,required:false,defaultMatch:k==='request_id',display:true,type:['quantity','revision'].includes(k)?'number':'string',canBeUsedToMatch:true})),attemptToConvertTypes:false,convertFieldsToString:false},options:{cellFormat:'RAW'}},[1720,y],4.7,{onError:'continueErrorOutput'});
 edge(w,'Is New',name,op==='append'?0:1);edge(w,name,'Read Saved Proposal');edge(w,name,'Service Unavailable',1);
}
add(w,'Read Saved Proposal','n8n-nodes-base.googleSheets',{...sheetBase('requests'),operation:'read'},[1950,350],4.7,{alwaysOutputData:true,executeOnce:true,onError:'continueRegularOutput'});
add(w,'Verify Readback','n8n-nodes-base.code',{jsCode:`const p=$('Validate and Plan').first().json,expected=p.write.row;\nconst found=$input.all().map(i=>i.json).filter(r=>r.request_id===expected.request_id);\nif(found.length!==1||Number(found[0].quantity)!==Number(expected.quantity)||Number(found[0].revision)!==Number(expected.revision)||found[0].status!==expected.status) return [{json:{ok:false,http_status:503,error:{code:'readback_failed',message:'ยังยืนยันผลบันทึกไม่ได้ กรุณาค้นหารายการก่อนลองใหม่'}}}];\nreturn [{json:{ok:true,http_status:p.http_status,result:{...p.result,request:found[0],readback_verified:true}}}];`},[2160,350],2);edge(w,'Read Saved Proposal','Verify Readback');edge(w,'Verify Readback','Respond');
add(w,'Service Unavailable','n8n-nodes-base.code',{jsCode:failCode},[1300,-180],2);edge(w,'Service Unavailable','Respond');
add(w,'Read Me','n8n-nodes-base.stickyNote',{content:'## BaanDee Stock Planner\n1. Import the four CSV tabs into Google Sheets.\n2. Set Spreadsheet ID on all Google Sheets nodes.\n3. Select your existing Google Sheets credential on all nodes.\n4. Use a protected webhook before public use.\n5. Publish and set N8N_WEBHOOK_URL on the local UI.\nSingle-operator prototype: Sheets writes are not atomic.\nBusiness rules are generated from src/core.mjs; do not edit only the embedded copy.',height:330,width:470},[-50,-330],1);
fs.writeFileSync('workflows/01_stock_planner_google_sheets.json',JSON.stringify(w,null,2));
const bridge=workflow('BaanDee Stock Planner - Local Bridge','BaanDeeLocalV1');
add(bridge,'Planner Webhook','n8n-nodes-base.webhook',{httpMethod:'POST',path:'baandee-stock-planner-local',authentication:'headerAuth',responseMode:'responseNode',options:{}},[0,0],2,{webhookId:randomUUID()});
add(bridge,'Planner Data API','n8n-nodes-base.httpRequest',{method:'POST',url:'http://127.0.0.1:8788/api/action',sendBody:true,specifyBody:'json',jsonBody:'={{ $json.body }}',options:{response:{response:{neverError:true,responseFormat:'json'}},timeout:10000}},[300,0],4.2,{onError:'continueErrorOutput'});
reply(bridge);edge(bridge,'Planner Webhook','Planner Data API');edge(bridge,'Planner Data API','Respond');
add(bridge,'Service Unavailable','n8n-nodes-base.code',{jsCode:failCode},[600,200],2);edge(bridge,'Planner Data API','Service Unavailable',1);edge(bridge,'Service Unavailable','Respond');
fs.writeFileSync('workflows/02_local_bridge.json',JSON.stringify(bridge,null,2));
const verify=workflow('BaanDee Stock Planner - Rule Verification','BaanDeeVerifyV1');
add(verify,'Run Verification','n8n-nodes-base.manualTrigger',{},[0,0]);
const raw=loadRaw();
const testCode=shared+`\nconst raw=${JSON.stringify(raw)};\nconst data=prepareData(raw),results=[];\nfunction check(name,expected,actual){results.push({name,expected,actual,pass:JSON.stringify(expected)===JSON.stringify(actual)});}\nconst e=evaluate(data);check('source products',82,e.summary.total);check('replenish',28,e.summary.needs_replenishment);check('manual review',5,e.summary.review);check('SKU-0001 qty',30,e.rows.find(r=>r.product_id==='SKU-0001').recommended_qty);\ncheck('stale blocks',82,evaluate(data,{as_of:'2026-08-02T09:00:00+07:00'}).summary.review);\ncheck('unknown SKU',404,safePlan({action:'evaluate',product_id:'SKU-9999'},data,[]).http_status);\ncheck('zero quantity',422,safePlan({action:'create',quantity:0,actor:'Tester'},data,[]).http_status);\nif(results.some(r=>!r.pass))throw Error(JSON.stringify(results));return results.map(r=>({json:r}));`;
add(verify,'Verify Shared Rules','n8n-nodes-base.code',{jsCode:testCode},[300,0],2);edge(verify,'Run Verification','Verify Shared Rules');
fs.writeFileSync('workflows/03_rule_verification.json',JSON.stringify(verify,null,2));
console.log('Built 3 workflows; rules embedded from src/core.mjs; sheetId:',sheetId);
