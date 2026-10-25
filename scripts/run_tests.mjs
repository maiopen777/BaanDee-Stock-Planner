import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const result=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/core.test.mjs'],{encoding:'utf8'});
fs.mkdirSync('tests/results',{recursive:true});
fs.writeFileSync('tests/results/unit-tests.tap',result.stdout+result.stderr);
console.log(result.stdout);if(result.stderr)console.error(result.stderr);
process.exitCode=result.status??1;
