const test = require('node:test');
const assert = require('node:assert/strict');
const { tools } = require('./tools');
const { executeTool } = require('./harness');
const { runKubernetes, validateKubernetes } = require('./kubernetes');

test('reads and non-delete changes execute without approval; delete waits', async () => {
  let executions = 0, approvals = 0;
  const registry = { kubernetes: { ...tools.kubernetes, run: async () => { executions++; return { ok: true }; } } };
  const signal = new AbortController().signal;
  for (const command of ['get', 'describe', 'logs', 'scale', 'top']) {
    await executeTool(registry, 'kubernetes', { command, args: [] }, signal, () => { assert.fail('unexpected approval'); });
  }
  assert.equal(executions, 5);
  await assert.rejects(executeTool(registry, 'kubernetes', { command: 'delete', args: ['pod', 'demo', '-n', 'default'] }, signal), /Human approval/);
  await assert.rejects(executeTool(registry, 'kubernetes', { command: 'delete', args: ['pod', 'demo'] }, signal, async () => false), { name: 'ApprovalRejected' });
  assert.equal(executions, 5);
  await executeTool(registry, 'kubernetes', { command: 'delete', args: ['pod', 'demo'] }, signal, async (_name, input) => { approvals++; assert.deepEqual(input, { command: 'delete', args: ['pod', 'demo'] }); return true; });
  assert.equal(executions, 6);
  assert.equal(approvals, 1);
});

test('uses an argument array without a shell and bounds output', async () => {
  const result = await runKubernetes({ command: 'get', args: ['pods', '-n', 'default; whoami'] }, {}, async (file, args, options) => {
    assert.equal(file, 'kubectl');
    assert.deepEqual(args, ['get', 'pods', '-n', 'default; whoami']);
    assert.equal(options.shell, undefined);
    return { stdout: 'x'.repeat(31000), stderr: '' };
  });
  assert.equal(result.truncated, true);
  assert.equal(result.stdout.length, 30000);
});

test('rejects combined commands, plugins and interactive sessions', () => {
  for (const input of [{ command: 'get pods; delete pods', args: [] }, { command: '--namespace', args: ['default', 'delete', 'pods'] }, { command: 'custom-plugin', args: [] }, { command: 'exec', args: ['-it', 'demo', '--', 'sh'] }]) assert.throws(() => validateKubernetes(input));
});

test('reports kubectl failure output', async () => {
  const result = await runKubernetes({ command: 'get', args: ['pods'] }, {}, async () => { throw { code: 1, message: 'Command failed', stderr: 'Forbidden' }; });
  assert.equal(result.exit_code, 1);
  assert.equal(result.stderr, 'Forbidden');
});
