const { commandText } = require('./kubernetes');
const { randomUUID } = require('node:crypto');

function createApprovals(timeoutMs = 300000) {
  const pending = new Map();
  function request(action, input, signal, emit) {
    signal.throwIfAborted();
    const approvalId = randomUUID();
    return new Promise((resolve, reject) => {
      const cleanup = () => { pending.delete(approvalId); clearTimeout(timer); signal.removeEventListener('abort', cancel); };
      const settle = (approved) => { cleanup(); resolve(approved); };
      const cancel = () => { cleanup(); reject(signal.reason); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Approval expired after five minutes. Start a new run to try again.')); }, timeoutMs);
      pending.set(approvalId, settle);
      signal.addEventListener('abort', cancel, { once: true });
      try {
        emit({ type: 'approval_required', title: input.command === 'create_yaml' ? 'Review YAML before creating the resource' : 'Approve Kubernetes deletion', approvalId,
          message: 'The run is paused. Approve this exact command or reject it to stop the run. Approval expires in five minutes.',
          payload: { action, input, command: action === 'kubernetes' ? commandText(input) : action, context: 'Backend current kubeconfig context', yaml: input.yaml, file: input.file, effect: input.command === 'create_yaml' ? 'Create this exact manifest. Existing resources are not overwritten.' : 'Execute the displayed delete command.' } });
      } catch (error) { cleanup(); reject(error); }
    });
  }
  function respond(id, approved) {
    if (typeof approved !== 'boolean') return false;
    const settle = pending.get(id);
    if (!settle) return false;
    settle(approved);
    return true;
  }
  return { request, respond };
}
module.exports = { createApprovals };
