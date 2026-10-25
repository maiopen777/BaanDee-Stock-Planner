import { DatabaseSync } from 'node:sqlite';
import { REQUEST_FIELDS, safePlan } from './core.mjs';
import { randomUUID } from 'node:crypto';
export class Store {
  constructor(path) {
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS requests (
        request_id TEXT PRIMARY KEY, product_id TEXT NOT NULL, location_id TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity>0),status TEXT NOT NULL,reason TEXT NOT NULL,
        actor TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        evaluated_as_of TEXT NOT NULL,evidence_json TEXT NOT NULL,idempotency_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_product ON requests(product_id,location_id) WHERE status!='cancelled';
      CREATE TABLE IF NOT EXISTS audit (audit_id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL,
        action TEXT NOT NULL,actor TEXT NOT NULL,recorded_at TEXT NOT NULL,before_json TEXT,after_json TEXT NOT NULL);`);
  }
  all() {return this.db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all().map(r=>({...r}));}
  execute(input,data,now=new Date().toISOString()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing=this.all(),p=safePlan(input,data,existing,now,`REQ-${randomUUID()}`);
      if(p.ok && p.write) {
        const {row,type}=p.write;
        if(type==='append') this.db.prepare(`INSERT INTO requests (${REQUEST_FIELDS.join(',')}) VALUES (${REQUEST_FIELDS.map(()=>'?').join(',')})`).run(...REQUEST_FIELDS.map(k=>row[k]));
        else {
          const fields=REQUEST_FIELDS.filter(k=>k!=='request_id');
          const result=this.db.prepare(`UPDATE requests SET ${fields.map(k=>`${k}=?`).join(',')} WHERE request_id=? AND revision=?`).run(...fields.map(k=>row[k]),row.request_id,p.write.expected_revision);
          if(result.changes!==1) throw new Error('Concurrent update prevented');
        }
        this.db.prepare('INSERT INTO audit(request_id,action,actor,recorded_at,before_json,after_json) VALUES(?,?,?,?,?,?)')
          .run(row.request_id,type,row.actor,now,type==='append'?null:JSON.stringify(existing.find(r=>r.request_id===row.request_id)),JSON.stringify(row));
        const saved=this.db.prepare('SELECT * FROM requests WHERE request_id=?').get(row.request_id);
        if(saved.quantity!==row.quantity||saved.revision!==row.revision)throw new Error('Readback verification failed');
        p.result.request={...saved}; p.result.readback_verified=true;
      }
      this.db.exec('COMMIT');
      return {...p,write:undefined};
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close(){this.db.close();}
}
