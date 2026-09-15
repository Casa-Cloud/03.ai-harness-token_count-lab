const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tools } = require('./tools');
const { executeTool } = require('./harness');
const { runKubernetes } = require('./kubernetes');
const { parseManifest, toYaml } = require('./manifests');
const manifest = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'review-demo', namespace: 'default' }, spec: { containers: [{ name: 'web', image: 'nginx:1.27' }] } };
for (const approved of [true, false]) test(`YAML creation ${approved ? 'uses reviewed bytes' : 'does not run when rejected'}`, async () => {
  let file, yaml, count = 0;
  const registry = { kubernetes: { ...tools.kubernetes, run: (input, context) => runKubernetes(input, context, async (_command, args) => {
    count++;
    assert.deepEqual(args, ['create', '-f', file]);
    assert.equal(await fs.readFile(file, 'utf8'), yaml);
    return { stdout: 'pod/review-demo created', stderr: '' };
  }) } };
  try {
    const pending = executeTool(registry, 'kubernetes', { command: 'create_yaml', manifest: JSON.stringify(manifest) }, new AbortController().signal, async (_action, input) => {
      file = input.file; yaml = input.yaml;
      assert.match(yaml, /kind: "Pod"/);
      assert.match(yaml, /    -\n      name: "web"/);
      assert.equal(await fs.readFile(file, 'utf8'), yaml);
      return approved;
    });
    if (approved) assert.equal((await pending).exit_code, 0);
    else await assert.rejects(pending, { name: 'ApprovalRejected' });
    assert.equal(count, approved ? 1 : 0);
  } finally { if (file) await fs.unlink(file); }
});
test('manifest validation and scalar escaping', () => {
  assert.throws(() => parseManifest('invalid'), /JSON/);
  assert.throws(() => parseManifest('{}'), /requires/);
  assert.equal(toYaml({ data: { text: 'a: b\nnext', enabled: 'true' } }), 'data:\n  text: "a: b\\nnext"\n  enabled: "true"');
});
