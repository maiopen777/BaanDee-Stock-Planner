import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = [
  'workflows/01_stock_planner_google_sheets.json',
  'workflows/02_local_bridge.json',
  'workflows/03_rule_verification.json',
];
const loaded = files.map(file => ({file, workflow: JSON.parse(fs.readFileSync(file, 'utf8'))}));
for (const {file, workflow} of loaded) {
  assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length > 0, `${file}: nodes missing`);
  const serialized = JSON.stringify(workflow);
  assert.ok(!/https:\/\/[A-Za-z0-9-]+\.app\.n8n\.cloud/.test(serialized), `${file}: private webhook URL found`);
  for (const node of workflow.nodes) assert.ok(!node.credentials, `${file}: credential reference on ${node.name}`);
}
const sheets = loaded[0].workflow;
const webhook = sheets.nodes.find(node => node.name === 'Planner Webhook');
assert.equal(webhook.parameters.authentication, 'headerAuth');
assert.equal(sheets.settings.saveDataSuccessExecution, 'none');
assert.equal(sheets.settings.saveDataErrorExecution, 'none');
assert.equal(sheets.settings.saveExecutionProgress, false);
assert.equal(sheets.nodes.filter(node => node.type === 'n8n-nodes-base.googleSheets' && node.parameters.operation === 'read').length, 5);
assert.ok(sheets.nodes.filter(node => node.type === 'n8n-nodes-base.googleSheets').every(node => node.parameters.documentId.value === 'REPLACE_WITH_SPREADSHEET_ID'));
const bridge = loaded[1].workflow.nodes.find(node => node.name === 'Planner Webhook');
assert.equal(bridge.parameters.authentication, 'headerAuth');
console.log(`PASS ${files.length} sanitized workflows; auth/settings/placeholder checks passed`);
