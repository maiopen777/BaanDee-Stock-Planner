import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readCSV,writeCSV} from '../src/csv.mjs';
import {prepareData,REQUEST_FIELDS} from '../src/core.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function loadRaw(){return {products:readCSV(path.join(root,'data/raw/products.csv')),inventory:readCSV(path.join(root,'data/raw/inventory_snapshot.csv')),policies:readCSV(path.join(root,'data/generated/replenishment_rules.csv'))};}
export function prepare(){
 const data=prepareData(loadRaw());
 fs.mkdirSync(path.join(root,'data/cleaned'),{recursive:true});
 for(const [name,rows] of [['products',data.products],['inventory_snapshot',data.inventory],['replenishment_rules',data.policies],['quality_issues',data.issues]])writeCSV(path.join(root,`data/cleaned/${name}.csv`),rows);
 writeCSV(path.join(root,'data/generated/requests_empty.csv'),[],REQUEST_FIELDS);
 fs.writeFileSync(path.join(root,'data/cleaned/quality_report.json'),JSON.stringify({raw:data.raw_counts,clean:{products:data.products.length,inventory:data.inventory.length,policies:data.policies.length},corrected:data.issues.filter(x=>x.disposition==='corrected').length,quarantined:data.issues.filter(x=>x.disposition==='quarantined').length,issues:data.issues},null,2));
 return data;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) console.log(JSON.stringify({counts:prepare().raw_counts},null,2));
