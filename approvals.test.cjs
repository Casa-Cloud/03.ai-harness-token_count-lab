const test = require('node:test');
const assert = require('node:assert/strict');
const { createApprovals } = require('./approvals');
const { executeTool } = require('./harness');

for (const choice of [true, false]) {
  test(`approval ${choice ? 'executes once' : 'rejects without execution'}`, async () => {
    const approvals = createApprovals();
    const controller = new AbortController();
    let count = 0, event;
    const registry = { get_pods: { requiresApproval: true, timeoutMs: 1000, inputSchema: { required: [], properties: {} }, run: async () => { count++; return { pods: [] }; } } };
    const run = executeTool(registry, 'get_pods', {}, controller.signal, (action, input, signal) => approvals.request(action, input, signal, (value) => { event = value; }));
    assert.equal(count, 0);
    assert.equal(event.payload.action, 'get_pods');
    assert.equal(approvals.respond('wrong-id', true), false);
    assert.equal(approvals.respond(event.approvalId, 'true'), false);
    assert.equal(approvals.respond(event.approvalId, choice), true);
    assert.equal(approvals.respond(event.approvalId, true), false);
    if (choice) assert.deepEqual(await run, { pods: [] });
    else await assert.rejects(run, { name: 'ApprovalRejected' });
    assert.equal(count, choice ? 1 : 0);
  });
}

test('cancellation removes approval and cannot subsequently authorize execution', async () => {
  const approvals = createApprovals();
  const controller = new AbortController();
  let event;
  const request = approvals.request('get_pods', { namespace: 'default' }, controller.signal, (value) => { event = value; });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(approvals.respond(event.approvalId, true), false);
});

test('approval expires without being granted', async () => {
  const approvals = createApprovals(10);
  let event;
  await assert.rejects(approvals.request('get_pods', {}, new AbortController().signal, (value) => { event = value; }), /expired/);
  assert.equal(approvals.respond(event.approvalId, true), false);
});

test('approval-required tools cannot run without an approval handler', async () => {
  let executed = false;
  const registry = { get_pods: { requiresApproval: true, inputSchema: { required: [], properties: {} }, run: () => { executed = true; } } };
  await assert.rejects(executeTool(registry, 'get_pods', {}, new AbortController().signal), /Human approval is required/);
  assert.equal(executed, false);
});
