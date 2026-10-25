import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Store} from './storage.mjs';
import {prepareData} from './core.mjs';
import {loadRaw} from '../scripts/prepare_data.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT??8787),apiPort=Number(process.env.API_PORT??8788);
const dbPath=process.env.PLANNER_DB??path.join(root,'var/planner.sqlite');
fs.mkdirSync(path.dirname(dbPath),{recursive:true});
const store=new Store(dbPath), csrf=randomBytes(24).toString('hex');
const n8nURL=process.env.N8N_WEBHOOK_URL??'';
function send(res,status,obj) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>65536)throw Error('body_too_large');}return JSON.parse(text||'{}');}
const allowHost=req=>['127.0.0.1','localhost'].includes(String(req.headers.host??'').split(':')[0]);
async function action(req,res,proxy){
 try{
   const payload=await body(req);
   if(proxy&&n8nURL){
     const response=await fetch(n8nURL,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.N8N_AUTH_TOKEN?{'X-Planner-Key':process.env.N8N_AUTH_TOKEN}:{})},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
     const data=await response.json();
     if(typeof data.ok!=='boolean')throw Error('invalid_workflow_response');
     send(res,data.http_status??response.status,data);
   }else{
     const data=prepareData(loadRaw());
     const result=store.execute(payload,data);send(res,result.http_status,result);
   }
 }catch(e){
   const invalid=e instanceof SyntaxError||e.message==='body_too_large';
   send(res,invalid?400:503,{ok:false,http_status:invalid?400:503,error:{code:invalid?'invalid_json':'service_unavailable',message:invalid?'รูปแบบข้อมูลไม่ถูกต้อง':'บริการไม่พร้อมใช้งาน ยังยืนยันการบันทึกไม่ได้ กรุณาค้นหารายการก่อนลองใหม่'}});
 }
}
const api=http.createServer((req,res)=>{
 if(!allowHost(req))return send(res,403,{ok:false,error:{code:'invalid_host'}});
 if(req.url==='/health')return send(res,200,{ok:true,service:'planner-data-service'});
 if(req.url==='/api/action'&&req.method==='POST')return action(req,res,false);
 send(res,404,{ok:false,error:{code:'not_found'}});
});
const web=http.createServer(async(req,res)=>{
 if(!allowHost(req))return send(res,403,{ok:false,error:{code:'invalid_host'}});
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/api/config')return send(res,200,{csrf,backend:n8nURL?'n8n':'local',demo:true});
 if(url.pathname==='/api/action'&&req.method==='POST'){
   if(req.headers['x-planner-csrf']!==csrf)return send(res,403,{ok:false,error:{code:'forbidden',message:'กรุณาเปิดหน้าจอใหม่'}});
   return action(req,res,true);
 }
 const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
 if(files[url.pathname]){
   const filename=files[url.pathname],type=filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html';
   res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"});
   return res.end(fs.readFileSync(path.join(root,'web',filename)));
 }
 send(res,404,{ok:false,error:{code:'not_found'}});
});
api.listen(apiPort,'127.0.0.1',()=>console.log(`Data service http://127.0.0.1:${apiPort}`));
web.listen(port,'127.0.0.1',()=>console.log(`BaanDee Stock Planner http://127.0.0.1:${port} | mode=${n8nURL?'n8n':'local'}`));
function shutdown(){web.close();api.close();store.close();process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
