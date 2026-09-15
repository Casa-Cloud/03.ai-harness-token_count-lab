const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('trace follows request, response, parse, tool, history, and final answer', async () => {
  let run;
  const app = { use() {}, get() {}, post(_path, handler) { run = handler; }, listen() {} };
  const express = Object.assign(() => app, { json() {}, static() {} });
  const requests = [];
  const decisions = [
    { thought: 'Calculate the expression.', action: 'calculate', input: { expression: '24 * 3' }, answer: '' },
    { thought: '', action: 'finish', input: {}, answer: '72' }
  ];
  const context = {
    require: (name) => name === 'express' ? express : name === 'dotenv' ? { config() {} } : require(name),
    __dirname,
    process: { env: { AZURE_OPENAI_KEY: 'test-secret', AZURE_OPENAI_ENDPOINT: 'https://example.test', AZURE_OPENAI_DEPLOYMENT: 'test', AZURE_OPENAI_API_VERSION: 'test' } },
    console, AbortController, AbortSignal,
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ model: 'test-model', usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 }, choices: [{ message: { content: JSON.stringify(decisions.shift()) } }] }) };
    }
  };
  loadServer(context);
  const events = [];
  let ended = false;
  const res = { on() {}, off() {}, status() { return this; }, set() {}, flushHeaders() {}, write(chunk) { events.push(JSON.parse(chunk.slice(6))); }, end() { ended = true; } };
  await run({ body: { goal: 'Calculate 24 * 3' } }, res);
  assert.deepEqual(events.map((e) => e.type), ['run_started', 'llm_request', 'llm_response', 'parsed', 'decision', 'tool_call', 'tool_result', 'history_updated', 'llm_request', 'llm_response', 'parsed', 'decision', 'completed']);
  assert.deepEqual(events.find((e) => e.type === 'llm_request').payload, requests[0]);
  assert.deepEqual(events.find((e) => e.type === 'llm_response').payload, { thought: 'Calculate the expression.', action: 'calculate', input: { expression: '24 * 3' }, answer: '' });
  assert.deepEqual(events.find((e) => e.type === 'llm_response').usage, { model: 'test-model', promptTokens: 120, completionTokens: 18, totalTokens: 138 });
  assert.ok(!JSON.stringify(events).includes('omit-me'));
  assert.equal(events.find((e) => e.type === 'tool_result').payload.result, 72);
  assert.match(requests[1].messages[1].content, /"result":72/);
  assert.equal(events.at(-1).answer, '72');
  assert.equal(ended, true);
  assert.ok(!JSON.stringify(events).includes('test-secret'));
});

for (const scenario of ['success', 'unknown city', 'HTTP failure', 'timeout', 'missing city']) {
  test(`weather tool: ${scenario}`, async () => {
    let run;
    const app = { use() {}, get() {}, post(_path, handler) { run = handler; }, listen() {} };
    const express = Object.assign(() => app, { json() {}, static() {} });
    const prompts = [];
    const calls = [];
    const decisions = [
      { thought: '', answer: '', action: 'get_weather', input: { city: scenario === 'missing city' ? '' : 'Singapore' } },
      ...(scenario === 'success' ? [{ thought: '', answer: '', action: 'calculate', input: { expression: '30 * 9 / 5 + 32' } }] : []),
      { thought: '', input: {}, action: 'finish', answer: 'Finished' }
    ];
    const context = {
      require: (name) => name === 'express' ? express : name === 'dotenv' ? { config() {} } : require(name),
      __dirname, console, AbortSignal, AbortController,
      process: { env: { AZURE_OPENAI_KEY: 'test-secret', AZURE_OPENAI_ENDPOINT: 'https://example.test', AZURE_OPENAI_DEPLOYMENT: 'test', AZURE_OPENAI_API_VERSION: 'test' } },
      fetch: async (url, options) => {
        if (url.startsWith('https://example.test')) {
          prompts.push(JSON.parse(options.body));
          return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(decisions.shift()) } }] }) };
        }
        calls.push(url);
        assert.ok(options.signal);
        if (scenario === 'timeout') throw new Error('Request timed out');
        if (scenario === 'HTTP failure') return { ok: false, status: 503 };
        await Promise.resolve();
        return { ok: true, json: async () => url.includes('geocoding-api')
          ? { results: scenario === 'unknown city' ? [] : [{ name: 'Singapore', country: 'Singapore', latitude: 1.29, longitude: 103.85 }] }
          : { timezone: 'Asia/Singapore', current: { time: '2026-09-12T12:00', temperature_2m: 30, relative_humidity_2m: 70, precipitation: 0, wind_speed_10m: 8 } } };
      }
    };
    loadServer(context);
    const events = [];
    await run({ body: { goal: 'Get Singapore weather and convert to Fahrenheit' } }, { on() {}, off() {}, status() {}, set() {}, flushHeaders() {}, write(chunk) { events.push(JSON.parse(chunk.slice(6))); }, end() {} });
    if (scenario === 'missing city') {
      assert.equal(events.at(-1).type, 'error');
      assert.match(events.at(-1).message, /invalid input.city/);
      assert.equal(calls.length, 0);
      return;
    }
    const results = events.filter((e) => e.type === 'tool_result');
    if (scenario === 'success') {
      assert.equal(results[0].payload.temperature_c, 30);
      assert.equal(results[1].payload.result, 86);
      assert.match(prompts[1].messages[1].content, /"temperature_c":30/);
      assert.match(prompts[2].messages[1].content, /"result":86/);
      assert.equal(calls.length, 2);
      assert.ok(calls[1].includes('latitude=1.29&longitude=103.85'));
    } else {
      assert.ok(results[0].payload.error);
      assert.match(prompts[1].messages[1].content, /"error":/);
      assert.equal(calls.length, scenario === 'missing city' ? 0 : 1);
    }
    assert.equal(events.at(-1).type, 'completed');
  });
}

function loadServer(context) {
  const originalRequire = context.require;
  const toolModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync('tools.js', 'utf8'), { ...context, module: toolModule });
  context.require = (name) => name === './tools' ? toolModule.exports : originalRequire(name);
  vm.runInNewContext(fs.readFileSync('server.js', 'utf8'), context);
}

test('disconnect cancels an in-flight LLM request and stops the loop', async () => {
  const { EventEmitter } = require('node:events');
  let run, started, llmSignal;
  const ready = new Promise((resolve) => { started = resolve; });
  const app = { use() {}, get() {}, post(_path, handler) { run = handler; }, listen() {} };
  const express = Object.assign(() => app, { json() {}, static() {} });
  const context = {
    require: (name) => name === 'express' ? express : name === 'dotenv' ? { config() {} } : require(name),
    __dirname, console, AbortSignal, AbortController,
    process: { env: { AZURE_OPENAI_KEY: 'test', AZURE_OPENAI_ENDPOINT: 'https://example.test', AZURE_OPENAI_DEPLOYMENT: 'test', AZURE_OPENAI_API_VERSION: 'test' } },
    fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
      llmSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      started();
    })
  };
  loadServer(context);
  const events = [];
  const res = Object.assign(new EventEmitter(), { status() {}, set() {}, flushHeaders() {}, write(chunk) { events.push(JSON.parse(chunk.slice(6))); }, end() {} });
  const running = run({ body: { goal: 'Check pods' } }, res);
  await ready;
  res.destroyed = true;
  res.emit('close');
  await running;
  assert.equal(llmSignal.aborted, true);
  assert.equal(res.listenerCount('close'), 0);
  assert.deepEqual(events.map((e) => e.type), ['run_started', 'llm_request']);
});
