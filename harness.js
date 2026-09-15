const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function toolCatalog(registry) {
  return Object.entries(registry).map(([name, tool]) => ({ name, description: tool.description, inputSchema: tool.inputSchema, permission: tool.permission, requiresApproval: typeof tool.requiresApproval === "function" ? tool.approvalPolicy : Boolean(tool.requiresApproval), timeoutMs: tool.timeoutMs }));
}

function validateDecision(decision, registry) {
  const fail = (message) => { throw new Error(`Invalid LLM decision: ${message}`); };
  if (!object(decision)) fail('expected an object.');
  const fields = ['thought', 'action', 'input', 'answer'];
  if (Object.keys(decision).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(decision, key))) fail('expected exactly thought, action, input, and answer.');
  if (typeof decision.thought !== 'string' || typeof decision.answer !== 'string' || typeof decision.action !== 'string' || !object(decision.input)) fail('incorrect field types.');
  if (decision.action === 'finish') {
    if (!decision.answer.trim() || Object.keys(decision.input).length) fail('finish requires an answer and empty input.');
    return decision;
  }
  if (!Object.hasOwn(registry, decision.action)) fail(`unknown action "${decision.action}".`);
  if (decision.answer !== '') fail('tool actions must have an empty answer.');
  const schema = registry[decision.action].inputSchema;
  for (const name of schema.required) if (!Object.hasOwn(decision.input, name)) fail(`missing input.${name}.`);
  for (const [name, value] of Object.entries(decision.input)) {
    if (!Object.hasOwn(schema.properties, name)) fail(`unexpected input.${name}.`);
    const rule = schema.properties[name];
    if (rule.type === 'array') {
      if (!Array.isArray(value) || value.length > rule.maxItems || value.some((item) => typeof item !== rule.items.type)) fail(`invalid input.${name}.`);
      continue;
    }
    if (typeof value !== rule.type || (rule.minLength && value.trim().length < rule.minLength) || value.length > rule.maxLength || (rule.pattern && !new RegExp(rule.pattern).test(value))) fail(`invalid input.${name}.`);
  }
  registry[decision.action].validateInput?.(decision.input);
  return decision;
}

async function executeTool(registry, action, input, runSignal, approve) {
  validateDecision({ thought: '', action, input, answer: '' }, registry);
  const tool = registry[action];
  input = JSON.parse(JSON.stringify(input));
  if (tool.prepareInput) input = await tool.prepareInput(input);
  runSignal.throwIfAborted();
  if (typeof tool.requiresApproval === "function" ? tool.requiresApproval(input) : tool.requiresApproval) {
    if (!approve) throw new Error(`Human approval is required for ${action}.`);
    if (!await approve(action, input, runSignal)) {
      const error = new Error('You rejected the tool call. No tool was executed; the run has stopped.');
      error.name = 'ApprovalRejected';
      throw error;
    }
  }
  const signal = AbortSignal.any([runSignal, AbortSignal.timeout(tool.timeoutMs)]);
  signal.throwIfAborted();
  try {
    const result = await tool.run(input, { signal });
    signal.throwIfAborted();
    return result;
  } catch (error) {
    runSignal.throwIfAborted();
    if (signal.aborted) return { error: `${action} exceeded its ${tool.timeoutMs}ms timeout.` };
    throw error;
  }
}

module.exports = { toolCatalog, validateDecision, executeTool };
