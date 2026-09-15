const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDecision, executeTool, toolCatalog } = require('./harness');
const { tools } = require('./tools');
const good = { thought: '', action: 'calculate', input: { expression: '24 * 3' }, answer: '' };

test('validates registry inputs and rejects unsupported or malformed decisions', () => {
  assert.equal(validateDecision(good, tools), good);
  assert.doesNotThrow(() => validateDecision({ ...good, action: 'kubernetes', input: { command: 'get', args: ['pods'] } }, tools));
  for (const decision of [null, [], {}, { ...good, action: 'toString' }, { ...good, action: 'delete_pods' }, { ...good, input: { expression: 'process.exit()' } }, { ...good, input: { expression: '1+1', extra: true } }, { ...good, answer: 'premature' }, { ...good, extra: true }, { ...good, action: 'finish', input: {}, answer: '' }]) {
    assert.throws(() => validateDecision(decision, tools), /Invalid LLM decision/);
  }
  assert.equal(toolCatalog(tools).length, 3);
  assert.ok(toolCatalog(tools).every((tool) => tool.inputSchema && tool.timeoutMs && tool.permission));
});

test('cancellation reaches active tool and prevents subsequent execution', async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const registry = { wait: { inputSchema: { properties: {}, required: [] }, timeoutMs: 1000, run: (_input, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    started();
  }) } };
  const pending = executeTool(registry, 'wait', {}, controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(executeTool(registry, 'wait', {}, controller.signal), { name: 'AbortError' });
});

test('tool timeouts return a visible error', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const registry = { wait: { inputSchema: { properties: {}, required: [] }, timeoutMs: 10, run: (_input, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) } };
    assert.match((await executeTool(registry, 'wait', {}, new AbortController().signal)).error, /timeout/);
  } finally { clearTimeout(keepAlive); }
});
