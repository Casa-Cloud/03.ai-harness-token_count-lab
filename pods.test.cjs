const test = require('node:test');
const assert = require('node:assert/strict');
const { getPods } = require('./pods');

test('lists pods with fixed arguments and preserves unhealthy container details', async () => {
  const result = await getPods({}, async (file, args, options) => {
    assert.equal(file, 'kubectl');
    assert.deepEqual(args, ['get', 'pods', '--namespace', 'default', '-o', 'json', '--request-timeout=15s']);
    assert.equal(options.timeout, 20000);
    assert.equal(options.shell, undefined);
    return { stdout: JSON.stringify({ items: [{ metadata: { name: 'demo' }, spec: { containers: [{}] }, status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: false, restartCount: 3, state: { waiting: { reason: 'CrashLoopBackOff' } } }] } }] }) };
  });
  assert.equal(result.pods[0].ready, '0/1');
  assert.equal(result.pods[0].restarts, 3);
  assert.equal(result.pods[0].containers[0].reason, 'CrashLoopBackOff');
});
test('rejects invalid namespaces without executing kubectl', async () => {
  for (const namespace of ['--all-namespaces', 'default; whoami', '', null]) {
    const result = await getPods({ namespace }, () => assert.fail('must not execute'));
    assert.ok(result.error);
  }
});
test('handles empty namespaces and command failures', async () => {
  assert.equal((await getPods({ namespace: 'kube-system' }, async () => ({ stdout: '{"items":[]}' }))).count, 0);
  for (const error of [{ code: 'ENOENT' }, { killed: true }, { stderr: 'Forbidden' }]) {
    assert.ok((await getPods({}, async () => { throw error; })).error);
  }
});
