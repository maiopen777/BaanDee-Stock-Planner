import fs from 'node:fs';
export function parseCSV(text) {
  const rows=[]; let row=[],value='',quoted=false;
  text=String(text).replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted; }
    else if(c===','&&!quoted){row.push(value);value='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(x=>x!==''))rows.push(row);row=[];value='';}
    else value+=c;
  }
  if(quoted) throw new Error('Unterminated CSV quote');
  if(value!==''||row.length){row.push(value);rows.push(row);}
  const header=rows.shift()??[];
  return rows.map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]??''])));
}
export const readCSV=path=>parseCSV(fs.readFileSync(path,'utf8'));
export function writeCSV(path,rows,fields=Object.keys(rows[0]??{})) {
  const escape=v=>`"${String(v??'').replaceAll('"','""')}"`;
  fs.writeFileSync(path,'\uFEFF'+[fields.map(escape).join(','),...rows.map(r=>fields.map(k=>escape(r[k])).join(','))].join('\r\n')+'\r\n');
}
