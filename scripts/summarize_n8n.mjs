import fs from 'node:fs';
const filename=process.argv[2];
const text=fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,'');
const index=text.search(/\{\r?\n/);
if(index<0)throw Error('No JSON execution output found');
const output=JSON.parse(text.slice(index));
const cases=output.data.resultData.runData['Verify Shared Rules'][0].data.main[0].map(r=>r.json);
fs.writeFileSync('tests/results/n8n-rule-results.json',JSON.stringify({status:output.status,finished:output.finished,results:cases},null,2));
console.log(JSON.stringify({status:output.status,cases:cases.length,passed:cases.filter(r=>r.pass).length}));
