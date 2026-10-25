import {readCSV,writeCSV} from '../src/csv.mjs';
// Synthetic rules intentionally include declared defects for data-quality demonstration.
const products=readCSV('data/raw/products.csv'),rows=[];
products.forEach((p,index)=>{
 const i=index+1;if(i===7)return;
 const minimum=10+(i%3)*5;
 const row={product_id:p.product_id,minimum_qty:minimum,target_qty:minimum+20,lead_time_days:1+i%7,effective_from:'2026-07-01',source:'team_synthetic_v1'};
 if(i===2)row.product_id=' sku0002 ';
 if(i===3)row.minimum_qty='';
 if(i===4)row.target_qty=5;
 if(i===5)row.minimum_qty=-1;
 rows.push(row);if(i===6)rows.push({...row,target_qty:99});
});
rows.push({product_id:'SKU-9999',minimum_qty:10,target_qty:30,lead_time_days:3,effective_from:'2026-07-01',source:'team_synthetic_v1'});
writeCSV('data/generated/replenishment_rules.csv',rows);
console.log(`Generated ${rows.length} policy rows from ${products.length} actual product IDs.`);
