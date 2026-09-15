const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

async function getPods({ namespace = 'default' } = {}, run = execute, signal) {
  if (typeof namespace !== 'string' || namespace.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(namespace)) {
    return { error: 'Provide a valid Kubernetes namespace (for example, default or kube-system).' };
  }
  const args = ['get', 'pods', '--namespace', namespace, '-o', 'json', '--request-timeout=15s'];
  try {
    // Fixed executable and argument array: no shell or arbitrary commands.
    const { stdout } = await run('kubectl', args, { signal, timeout: 20000, maxBuffer: 5 * 1024 * 1024 });
    const list = JSON.parse(stdout);
    if (!Array.isArray(list.items)) throw new Error('kubectl did not return a pod list.');
    const pods = list.items.map((pod) => {
      const containers = pod.status?.containerStatuses || [];
      const initContainers = pod.status?.initContainerStatuses || [];
      return {
        name: pod.metadata?.name,
        namespace: pod.metadata?.namespace || namespace,
        phase: pod.status?.phase || 'Unknown',
        ready: `${containers.filter((container) => container.ready).length}/${pod.spec?.containers?.length || 0}`,
        restarts: [...initContainers, ...containers].reduce((sum, container) => sum + (container.restartCount || 0), 0),
        deleting: Boolean(pod.metadata?.deletionTimestamp),
        created_at: pod.metadata?.creationTimestamp,
        conditions: (pod.status?.conditions || []).map(({ type, status, reason }) => ({ type, status, reason })),
        containers: [...initContainers, ...containers].map((container) => ({
          name: container.name,
          ready: Boolean(container.ready),
          restarts: container.restartCount || 0,
          state: Object.keys(container.state || {})[0] || 'unknown',
          reason: container.state?.waiting?.reason || container.state?.terminated?.reason,
          exit_code: container.state?.terminated?.exitCode
        }))
      };
    });
    return { namespace, command: `kubectl ${args.join(' ')}`, count: pods.length, pods };
  } catch (error) {
    signal?.throwIfAborted();
    if (error.code === 'ENOENT') return { error: 'kubectl is not installed or is not on the backend PATH.' };
    if (error.killed) return { error: 'kubectl timed out. Check your cluster connection and authentication.' };
    return { error: `Could not list pods: ${(error.stderr || error.message).trim().slice(0, 1000)}` };
  }
}

module.exports = { getPods };
