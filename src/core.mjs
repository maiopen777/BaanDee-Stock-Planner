// Shared deterministic business rules. The workflow builder embeds this exact source in n8n.
export const DEMO_AS_OF = '2026-07-31T09:00:00+07:00';
export const MAX_AGE_HOURS = 24;
export const REQUEST_FIELDS = ['request_id','product_id','location_id','quantity','status','reason','actor','revision','created_at','updated_at','evaluated_as_of','evidence_json','idempotency_key','fingerprint'];
export class DomainError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
export function normalizeId(value) {
  const s=String(value ?? '').trim().toUpperCase();
  if(/^SKU-[A-Z]{2}-\d{3}$/.test(s)) return s;
  const match=/^SKU-?(\d{4})$/.exec(s);
  return match ? `SKU-${match[1]}` : null;
}
export function integer(value) {
  if (typeof value === 'boolean' || value == null || String(value).trim()==='') return null;
  if (!/^\d+$/.test(String(value).trim())) return null;
  const n=Number(value);
  return Number.isSafeInteger(n) ? n : null;
}
export function timestamp(value) {
  const s=String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)) return NaN;
  const n=Date.parse(s);
  // Date.parse normalizes impossible calendar dates; reject them first.
  const [year,month,day]=s.slice(0,10).split('-').map(Number);
  if(month<1 || month>12 || day<1 || day>new Date(Date.UTC(year,month,0)).getUTCDate()) return NaN;
  return n;
}
export function prepareData(raw) {
  const issues=[];
  const issue=(source,key,field,before,after,disposition,rule)=>issues.push({source,key,field,before:String(before??''),after:String(after??''),disposition,rule});
  const categories={'kitchen':'Kitchen','bathroom':'Bathroom','bedding':'Bedding','bed room':'Bedding','storage':'Storage'};
  const products=[];
  const groupedProducts=new Map();
  for(const r of raw.products) {
    const id=normalizeId(r.product_id);
    if(!id) { issue('products',r.product_id,'product_id',r.product_id,'','quarantined','invalid_product_id'); continue; }
    if(!groupedProducts.has(id)) groupedProducts.set(id,[]);
    groupedProducts.get(id).push(r);
  }
  for(const [id,group] of groupedProducts) {
    if(group.length!==1) { for(const r of group) issue('products',id,'product_id',r.product_id,'','quarantined','duplicate_product_id'); continue; }
    const r=group[0], category=categories[String(r.category).trim().toLowerCase()];
    const price=Number(r.unit_price_thb);
    if(!category || !String(r.product_name??'').trim() || !String(r.unit_price_thb??'').trim() || !Number.isFinite(price) || price<0) {
      issue('products',id,'record',JSON.stringify(r),'','quarantined','invalid_product_fields'); continue;
    }
    if(r.category!==category) issue('products',id,'category',r.category,category,'corrected','explicit_category_dictionary');
    if(r.product_id!==id) issue('products',id,'product_id',r.product_id,id,'corrected','documented_sku_format');
    products.push({...r,product_id:id,category,unit_price_thb:price});
  }
  const known=new Set(products.map(r=>r.product_id));
  const inventory=[],invGroups=new Map();
  for(const r of raw.inventory) {
    const id=normalizeId(r.product_id), location=String(r.location_id??'').trim();
    const key=`${id}|${location}`;
    if(!invGroups.has(key)) invGroups.set(key,[]);
    invGroups.get(key).push(r);
  }
  for(const [key,group] of invGroups) {
    const r=group[0],id=normalizeId(r.product_id),qty=integer(r.available_qty);
    if(group.length!==1 || !known.has(id) || r.location_id!=='BKK-DC' || qty===null || !Number.isFinite(timestamp(r.as_of))) {
      for(const x of group) issue('inventory',key,'record',JSON.stringify(x),'','quarantined',group.length!==1?'duplicate_inventory_key':'invalid_or_orphan_inventory');
      continue;
    }
    inventory.push({...r,product_id:id,available_qty:qty});
  }
  const policies=[],policyGroups=new Map();
  for(const r of raw.policies) {
    const id=normalizeId(r.product_id);
    if(!id || !known.has(id)) { issue('policies',r.product_id,'product_id',r.product_id,'','quarantined','unknown_product'); continue; }
    if(r.product_id!==id) issue('policies',id,'product_id',r.product_id,id,'corrected','documented_sku_format');
    if(!policyGroups.has(id)) policyGroups.set(id,[]);
    policyGroups.get(id).push({...r,product_id:id});
  }
  for(const [id,group] of policyGroups) {
    if(group.length!==1) { for(const r of group) issue('policies',id,'record',JSON.stringify(r),'','quarantined','duplicate_policy_requires_review'); continue; }
    const r=group[0], min=integer(r.minimum_qty),target=integer(r.target_qty),lead=integer(r.lead_time_days);
    const effective=String(r.effective_from??'');
    if(min===null || target===null || lead===null || target<min || target>100000 || lead<1 || lead>365 || !/^\d{4}-\d{2}-\d{2}$/.test(effective) || !Number.isFinite(timestamp(`${effective}T00:00:00+07:00`))) {
      issue('policies',id,'record',JSON.stringify(r),'','quarantined','missing_or_invalid_policy_values'); continue;
    }
    policies.push({...r,minimum_qty:min,target_qty:target,lead_time_days:lead});
  }
  return {products,inventory,policies,issues,raw_counts:{products:raw.products.length,inventory:raw.inventory.length,policies:raw.policies.length}};
}
export function evaluate(data,input={},now=new Date().toISOString()) {
  const mode=input.mode??'demo';
  if(!['demo','live'].includes(mode)) throw new DomainError(422,'invalid_mode','โหมดต้องเป็น demo หรือ live');
  const asOf=mode==='live'?now:(input.as_of??DEMO_AS_OF), reference=timestamp(asOf);
  if(!Number.isFinite(reference)) throw new DomainError(422,'invalid_reference_time','วันเวลาต้องเป็น ISO 8601 พร้อมเขตเวลา');
  const asked=input.product_id?normalizeId(input.product_id):null;
  if(input.product_id && (!asked || !data.products.some(p=>p.product_id===asked))) throw new DomainError(404,'product_not_found','ไม่พบรหัสสินค้า');
  const rows=data.products.filter(p=>!asked||p.product_id===asked).map(p=>{
    const stock=data.inventory.find(s=>s.product_id===p.product_id && s.location_id==='BKK-DC');
    const policy=data.policies.find(s=>s.product_id===p.product_id);
    const reasons=[];
    let age=null;
    if(!stock) reasons.push('ไม่พบสต็อกที่ผ่านการตรวจสอบ');
    else {
      age=(reference-timestamp(stock.as_of))/3600000;
      if(age<0) reasons.push('เวลาสต็อกอยู่ในอนาคตเมื่อเทียบกับเวลาประเมิน');
      else if(age>MAX_AGE_HOURS) reasons.push('ข้อมูลสต็อกเก่ากว่า 24 ชั่วโมง');
    }
    if(!policy) reasons.push('ไม่มีนโยบายที่ผ่านการตรวจสอบ');
    else if(reference<timestamp(`${policy.effective_from}T00:00:00+07:00`)) reasons.push('นโยบายยังไม่มีผลในเวลาประเมิน');
    const state=reasons.length?'review':stock.available_qty<policy.minimum_qty?'needs_replenishment':'sufficient';
    return {...p,location_id:'BKK-DC',available_qty:stock?.available_qty??null,stock_as_of:stock?.as_of??null,age_hours:age,
      minimum_qty:policy?.minimum_qty??null,target_qty:policy?.target_qty??null,lead_time_days:policy?.lead_time_days??null,
      policy_effective_from:policy?.effective_from??null,state,reasons,
      recommended_qty:reasons.length?null:state==='needs_replenishment'?policy.target_qty-stock.available_qty:0,
      source_stock:'data/raw/inventory_snapshot.csv',source_policy:'data/generated/replenishment_rules.csv'};
  });
  return {mode,evaluated_as_of:asOf,max_age_hours:MAX_AGE_HOURS,rows,
    summary:{total:rows.length,needs_replenishment:rows.filter(r=>r.state==='needs_replenishment').length,sufficient:rows.filter(r=>r.state==='sufficient').length,review:rows.filter(r=>r.state==='review').length},
    quality:{raw_counts:data.raw_counts,clean_counts:{products:data.products.length,inventory:data.inventory.length,policies:data.policies.length},issues:data.issues}};
}
export function planAction(input,data,existing=[],now=new Date().toISOString(),newId=`REQ-${Date.now()}`) {
  const success=(result,write=null,status=200)=>({ok:true,http_status:status,result,write});
  const action=input.action??'evaluate';
  if(action==='evaluate') return success(evaluate(data,input,now));
  if(action==='list') return success({requests:existing.map(r=>({...r,revision:Number(r.revision),quantity:Number(r.quantity)})).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))});
  if(action==='get') {
    const r=existing.find(r=>r.request_id===input.request_id);
    if(!r) throw new DomainError(404,'request_not_found','ไม่พบใบเสนอ');
    return success({request:r});
  }
  if(!['create','update'].includes(action)) throw new DomainError(422,'unknown_action','ไม่รองรับคำสั่งนี้');
  const quantity=integer(input.quantity);
  if(quantity===null || quantity<1 || quantity>100000) throw new DomainError(422,'invalid_quantity','จำนวนต้องเป็นจำนวนเต็ม 1–100000 ชิ้น');
  const actor=String(input.actor??'').trim(),reason=String(input.reason??'').trim();
  if(!actor || actor.length>80 || reason.length>1000) throw new DomainError(422,'invalid_details','ระบุผู้ทำรายการไม่เกิน 80 ตัวอักษร และเหตุผลไม่เกิน 1000 ตัวอักษร');
  if(action==='create') {
    const key=String(input.idempotency_key??'');
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new DomainError(422,'invalid_idempotency_key','ต้องมีรหัสป้องกันการส่งซ้ำ');
    const fingerprint=JSON.stringify([normalizeId(input.product_id),quantity,actor,reason,input.mode??'demo',input.as_of??DEMO_AS_OF]);
    const replay=existing.find(r=>r.idempotency_key===key);
    if(replay) {
      if(replay.fingerprint!==fingerprint) throw new DomainError(409,'idempotency_conflict','รหัสส่งซ้ำถูกใช้กับข้อมูลคนละชุด');
      return success({request:replay,replayed:true});
    }
    if(!input.product_id) throw new DomainError(422,'product_required','ต้องเลือกรหัสสินค้า');
    const e=evaluate(data,input,now),r=e.rows[0];
    if(r.state!=='needs_replenishment') throw new DomainError(422,'cannot_replenish',r.state==='review'?r.reasons.join('; '):'สินค้ายังไม่ต่ำกว่าเกณฑ์');
    if(existing.some(x=>x.product_id===r.product_id && x.location_id===r.location_id && x.status!=='cancelled')) throw new DomainError(409,'duplicate_active_request','มีใบเสนอของสินค้านี้อยู่แล้ว กรุณาเปิดรายการเดิม');
    if(quantity!==r.recommended_qty && !reason) throw new DomainError(422,'override_reason_required','ถ้าเปลี่ยนจำนวนจากคำแนะนำ ต้องระบุเหตุผล');
    const row={request_id:newId,product_id:r.product_id,location_id:r.location_id,quantity,status:'draft',reason,actor,revision:1,created_at:now,updated_at:now,
      evaluated_as_of:e.evaluated_as_of,evidence_json:JSON.stringify(r),idempotency_key:key,fingerprint};
    return success({request:row,replayed:false},{type:'append',row},201);
  }
  const previous=existing.find(r=>r.request_id===input.request_id);
  if(!previous) throw new DomainError(404,'request_not_found','ไม่พบใบเสนอ');
  if(integer(input.revision)!==Number(previous.revision)) throw new DomainError(409,'revision_conflict','รายการเปลี่ยนแล้ว กรุณาเปิดข้อมูลล่าสุดก่อนบันทึก');
  const transitions={draft:['draft','submitted','cancelled'],submitted:['submitted','draft','approved','cancelled']};
  const status=String(input.status??previous.status);
  if(!transitions[previous.status]?.includes(status)) throw new DomainError(409,'invalid_transition','สถานะนี้แก้ไขไม่ได้ หรือการเปลี่ยนสถานะไม่ถูกต้อง');
  let evidence=previous.evidence_json,asOf=previous.evaluated_as_of;
  if(status!=='cancelled') {
    const e=evaluate(data,{...input,product_id:previous.product_id},now),r=e.rows[0];
    if(r.state!=='needs_replenishment') throw new DomainError(422,'cannot_replenish','ข้อมูลล่าสุดไม่พร้อมให้เสนอเติม กรุณาตรวจสอบ');
    if(quantity!==r.recommended_qty && !reason) throw new DomainError(422,'override_reason_required','ถ้าเปลี่ยนจำนวนจากคำแนะนำ ต้องระบุเหตุผล');
    evidence=JSON.stringify(r); asOf=e.evaluated_as_of;
  } else if(!reason) throw new DomainError(422,'cancel_reason_required','กรุณาระบุเหตุผลยกเลิก');
  const row={...previous,quantity,status,reason,actor,revision:Number(previous.revision)+1,updated_at:now,evaluated_as_of:asOf,evidence_json:evidence};
  return success({request:row},{type:'update',row,expected_revision:Number(previous.revision)});
}
export function safePlan(input,data,existing,now,newId) {
  try { return planAction(input,data,existing,now,newId); }
  catch(e) { if(!(e instanceof DomainError)) throw e; return {ok:false,http_status:e.status,error:{code:e.code,message:e.message},write:null}; }
}
