const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function parseManifest(text) {
  let manifest;
  try { manifest = JSON.parse(text); } catch { throw new Error('manifest must be a JSON string containing one Kubernetes resource.'); }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object' || typeof manifest.apiVersion !== 'string' || !manifest.apiVersion || typeof manifest.kind !== 'string' || !manifest.kind || typeof manifest.metadata?.name !== 'string' || !manifest.metadata.name) throw new Error('Manifest requires apiVersion, kind, and metadata.name.');
  if (manifest.kind === 'List') throw new Error('Create one resource per reviewed manifest.');
  return manifest;
}
// JSON-quoted scalars are valid YAML and preserve types and special characters.
function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) return value.length ? value.map((item) => item !== null && typeof item === 'object' && Object.keys(item).length ? `${pad}-\n${toYaml(item, indent + 2)}` : `${pad}- ${JSON.stringify(item)}`).join('\n') : `${pad}[]`;
  if (value !== null && typeof value === 'object') return Object.keys(value).length ? Object.entries(value).map(([key, item]) => {
    const name = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key);
    return item !== null && typeof item === 'object' && Object.keys(item).length ? `${pad}${name}:\n${toYaml(item, indent + 2)}` : `${pad}${name}: ${JSON.stringify(item)}`;
  }).join('\n') : `${pad}{}`;
  return pad + JSON.stringify(value);
}
async function prepareManifest(input) {
  if (input.command !== 'create_yaml') return input;
  const manifest = parseManifest(input.manifest);
  const yaml = toYaml(manifest) + '\n';
  const directory = path.join(__dirname, 'generated-manifests');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${randomUUID()}.yaml`);
  await fs.writeFile(file, yaml, { mode: 0o600, flag: 'wx' });
  return { ...input, yaml, file };
}
module.exports = { parseManifest, toYaml, prepareManifest };
