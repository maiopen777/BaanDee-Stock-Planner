const $=id=>document.getElementById(id);
const escape=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={needs_replenishment:'ควรเสนอเติม',sufficient:'เพียงพอ',review:'รอตรวจสอบ',draft:'ร่าง',submitted:'รอตรวจ',approved:'อนุมัติในต้นแบบ',cancelled:'ยกเลิก'};
let config,report,requests=[],editing=null,token=null,selected=null;
function context(){return {mode:$('mode').value,as_of:$('as-of').value+':00+07:00'};}
function notice(text,error=false){$('alert').hidden=false;$('alert').className=error?'error':'';$('alert').textContent=text;}
async function call(payload){
 const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Planner-CSRF':config.csrf},body:JSON.stringify(payload)});
 let data;try{data=await response.json();}catch{throw Error('บริการตอบข้อมูลไม่ถูกต้อง ยังยืนยันการบันทึกไม่ได้');}
 if(!data.ok)throw Error(data.error?.message??'บริการไม่พร้อมใช้งาน');
 return data.result;
}
function renderStock(){
 if(!report)return;
 const query=$('search').value.toLowerCase(),filter=$('state-filter').value;
 const rows=report.rows.filter(r=>(filter==='all'||r.state===filter)&&`${r.product_id} ${r.product_name} ${r.category}`.toLowerCase().includes(query));
 $('stock-rows').innerHTML=rows.length?rows.map(r=>`<tr><td><strong>${escape(r.product_name)}</strong><small>${escape(r.product_id)} · ${escape(r.category)}</small></td><td class="num">${escape(r.available_qty)}</td><td>${escape(r.minimum_qty)} / ${escape(r.target_qty)}<small>รอสินค้า ${escape(r.lead_time_days)} วัน</small></td><td class="num">${escape(r.recommended_qty)}</td><td><span class="pill ${r.state}">${labels[r.state]}</span><small>${r.reasons.length?escape(r.reasons.join(' · ')):'สต็อก ณ '+escape(r.stock_as_of)}</small></td><td><button class="row-button" data-create="${r.product_id}" ${r.state!=='needs_replenishment'?'disabled':''}>สร้างใบเสนอ</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">ไม่พบสินค้าตามเงื่อนไข</td></tr>';
}
async function evaluate(){
 $('evaluate').disabled=true;
 try{
 report=await call({action:'evaluate',...context()});
 for(const [id,key]of [['total','total'],['needs','needs_replenishment'],['sufficient','sufficient'],['review','review']])$(id).textContent=report.summary[key];
 $('evaluation-time').textContent=`ประเมิน ณ ${report.evaluated_as_of} · ข้อมูลสต็อก: data/raw/inventory_snapshot.csv`;
 renderStock();renderQuality();
 }catch(e){notice(e.message,true);}finally{$('evaluate').disabled=false;}
}
function renderQuality(){
 const q=report.quality;
 $('quality-summary').textContent=`ข้อมูลดิบ: สินค้า ${q.raw_counts.products} / สต็อก ${q.raw_counts.inventory} / นโยบาย ${q.raw_counts.policies} แถว · ผ่านการตรวจ: ${q.clean_counts.products} / ${q.clean_counts.inventory} / ${q.clean_counts.policies} แถว · ประวัติการจัดการ ${q.issues.length} รายการ`;
 $('quality-rows').innerHTML=q.issues.map(r=>`<tr><td>${escape(r.source)}<small>${escape(r.key)}</small></td><td>${escape(r.before)}</td><td>${r.disposition==='quarantined'?'แยกให้คนตรวจ ไม่ใช้คำนวณ':escape(r.after)}</td><td><span class="pill ${r.disposition==='quarantined'?'review':'sufficient'}">${r.disposition==='quarantined'?'รอตรวจ':'ปรับตามกฎ'}</span><small>${escape(r.rule)}</small></td></tr>`).join('');
}
async function refreshRequests(){
 requests=(await call({action:'list'})).requests;$('request-count').textContent=requests.length;
 $('request-rows').innerHTML=requests.length?requests.map(r=>`<tr><td><strong>${escape(r.product_id)}</strong><small>${escape(r.request_id)} · รุ่น ${escape(r.revision)}</small><small>${escape(r.reason||'ไม่มีหมายเหตุ')}</small></td><td class="num">${escape(r.quantity)}</td><td><span class="pill ${escape(r.status)}">${escape(labels[r.status]??r.status)}</span></td><td>${escape(r.actor)}<small>${escape(r.updated_at)}</small></td><td><button class="row-button" data-edit="${escape(r.request_id)}">เปิดรายการ</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty">ยังไม่มีใบเสนอ เริ่มสร้างจากหน้าตรวจสต็อกได้เลย</td></tr>';
}
function showTab(name){for(const n of ['stock','requests','quality'])$(n+'-panel').hidden=n!==name;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));}
function createDialog(id){
 selected=report.rows.find(r=>r.product_id===id);editing=null;token=crypto.randomUUID();
 $('dialog-kind').textContent='สร้างใบเสนอเติมสินค้า';$('dialog-product').textContent=`${selected.product_id} · ${selected.product_name}`;
 $('dialog-evidence').textContent=`คงเหลือ ${selected.available_qty} · ขั้นต่ำ ${selected.minimum_qty} · เป้าหมาย ${selected.target_qty} · แนะนำเติม ${selected.recommended_qty} ชิ้น`;
 $('quantity').value=selected.recommended_qty;$('reason').value='';$('status-label').hidden=true;$('dialog-error').hidden=true;$('save-request').hidden=false;$('quantity').disabled=false;$('reason').disabled=false;$('actor').disabled=false;
 $('request-dialog').showModal();
}
async function editDialog(id){
 try{
 editing=(await call({action:'get',request_id:id})).request;selected=null;token=null;
 $('dialog-kind').textContent=`ใบเสนอรุ่น ${editing.revision}`;$('dialog-product').textContent=editing.product_id;
 $('dialog-evidence').textContent=`${editing.request_id} · ประเมิน ณ ${editing.evaluated_as_of}`;
 $('quantity').value=editing.quantity;$('reason').value=editing.reason;$('actor').value=editing.actor;$('status-label').hidden=false;
 const options=editing.status==='draft'?['draft','submitted','cancelled']:editing.status==='submitted'?['submitted','draft','approved','cancelled']:[editing.status];
 $('request-status').innerHTML=options.map(s=>`<option value="${s}">${labels[s]}</option>`).join('');
 const locked=['approved','cancelled'].includes(editing.status);
 for(const id of ['quantity','reason','actor','request-status'])$(id).disabled=locked;
 $('save-request').hidden=locked;$('dialog-error').hidden=true;$('request-dialog').showModal();
 }catch(e){notice(e.message,true);}
}
$('request-form').addEventListener('submit',async event=>{
 event.preventDefault();$('save-request').disabled=true;$('dialog-error').hidden=true;
 try{
 const input={...context(),quantity:$('quantity').value,actor:$('actor').value,reason:$('reason').value};
 const payload=editing?{...input,action:'update',request_id:editing.request_id,revision:editing.revision,status:$('request-status').value}:{...input,action:'create',product_id:selected.product_id,idempotency_key:token};
 const result=await call(payload);
 $('request-dialog').close();await refreshRequests();showTab('requests');
 notice(`บันทึกและเรียกกลับสำเร็จ: ${result.request.product_id} จำนวน ${result.request.quantity} ชิ้น · ${labels[result.request.status]}`);
 }catch(e){$('dialog-error').textContent=e.message;$('dialog-error').hidden=false;}finally{$('save-request').disabled=false;}
});
$('stock-rows').addEventListener('click',e=>{const b=e.target.closest('[data-create]');if(b&&!b.disabled)createDialog(b.dataset.create);});
$('request-rows').addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)editDialog(b.dataset.edit);});
for(const id of ['close-dialog','cancel-dialog'])$(id).onclick=()=>$('request-dialog').close();
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{showTab(b.dataset.tab);if(b.dataset.tab==='requests')refreshRequests().catch(e=>notice(e.message,true));});
$('evaluate').onclick=evaluate;$('search').oninput=renderStock;$('state-filter').onchange=renderStock;
$('refresh-requests').onclick=()=>refreshRequests().catch(e=>notice(e.message,true));
$('mode').onchange=()=>{
 const live=$('mode').value==='live';$('as-of').disabled=live;
 $('mode-title').textContent=live?'ประเมินกับเวลาปัจจุบัน':'โหมดสาธิตข้อมูลย้อนหลัง';
 $('mode-description').textContent=live?'ข้อมูลตัวอย่างเป็นสต็อกเก่า ระบบจะหยุดเสนอเติมเมื่อเกิน 24 ชั่วโมง':'สต็อกต้นฉบับ ณ 31 ก.ค. 2026 เวลา 06:00 น. ไม่ใช่สต็อกปัจจุบัน';evaluate();
};
try{config=await(await fetch('/api/config')).json();$('backend').textContent=config.backend==='n8n'?'เชื่อมผ่าน n8n':'โหมดบนเครื่อง · SQLite';await evaluate();await refreshRequests();}catch(e){notice(e.message,true);}
