import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const manifest=JSON.parse(fs.readFileSync('data/source_manifest.json','utf8'));
for(const source of manifest.files){const actual=createHash('sha256').update(fs.readFileSync(source.file)).digest('hex');assert.equal(actual,source.sha256);console.log('PASS unchanged source',source.file);}
