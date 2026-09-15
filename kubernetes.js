const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const fs = require('node:fs/promises');
const { parseManifest } = require('./manifests');
// Built-in commands only: unknown names must not invoke local kubectl plugins.
const commands = new Set('get describe logs events top explain api-resources api-versions cluster-info version auth config create apply replace patch edit delete scale autoscale rollout set label annotate taint cordon uncordon drain wait exec cp attach run expose port-forward proxy diff kustomize certificate completion options plugin'.split(' '));
function validateKubernetes(input) {
  if (input.command === 'create_yaml') {
    if (input.args !== undefined) throw new Error('create_yaml uses manifest only; omit args.');
    parseManifest(input.manifest);
    return;
  }
  if (input.manifest !== undefined) throw new Error('manifest is only accepted for create_yaml.');
  if (['create', 'run', 'expose', 'apply', 'replace'].includes(input.command)) throw new Error('Use create_yaml for resource creation so the YAML can be reviewed before execution.');
  if (!commands.has(input.command)) throw new Error('Use a supported kubectl built-in command as command, without flags or spaces.');
  if (!Array.isArray(input.args) || input.args.length > 100 || input.args.some((arg) => typeof arg !== 'string' || arg.length > 10000 || arg.includes('\0'))) throw new Error('args must be an array of at most 100 strings without null bytes.');
  // These need an interactive terminal/editor or a persistent connection.
  if (['edit', 'attach', 'port-forward', 'proxy'].includes(input.command) || input.args.some((arg) => ['-it', '-ti', '-i', '--stdin', '-t', '--tty'].includes(arg) || /^(--stdin|--tty)=true$/.test(arg))) throw new Error('Interactive and persistent commands are not supported by this request/response tool.');
}
function commandText(input) {
  if (input.command === 'create_yaml') return `kubectl create -f ${input.file || '<reviewed-manifest.yaml>'}`;
  return ['kubectl', input.command, ...input.args].map((arg) => /^[a-zA-Z0-9_./:=,@-]+$/.test(arg) ? arg : JSON.stringify(arg)).join(' ');
}
async function runKubernetes(input, { signal } = {}, run = execute) {
  validateKubernetes(input);
  try {
    if (input.command === 'create_yaml') {
      if (!input.file || !input.yaml) throw new Error('A prepared and approved YAML manifest is required.');
      await fs.writeFile(input.file, input.yaml, { mode: 0o600 });
    }
    const args = input.command === 'create_yaml' ? ['create', '-f', input.file] : [input.command, ...input.args];
    const { stdout, stderr } = await run('kubectl', args, { signal, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    return { command: commandText(input), exit_code: 0, stdout: stdout.slice(0, 30000), stderr: stderr.slice(0, 5000), truncated: stdout.length > 30000 || stderr.length > 5000 };
  } catch (error) {
    signal?.throwIfAborted();
    return { command: commandText(input), error: error.code === 'ENOENT' ? 'kubectl is not installed or not on the backend PATH.' : error.killed ? 'kubectl exceeded its 60-second limit.' : error.message, exit_code: error.code, stdout: (error.stdout || '').slice(0, 30000), stderr: (error.stderr || '').slice(0, 5000) };
  }
}
module.exports = { validateKubernetes, commandText, runKubernetes };
