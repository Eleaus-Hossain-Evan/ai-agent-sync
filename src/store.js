// tools.conf and tools.ignore live in Dropbox/AIAgentsShared, so both Macs
// share them. The format matches the v3 bash script:
//   tools.conf:   id|Label|detect paths (colon-separated)|item path|file or dir
//   tools.ignore: one ~ path per line
import fs from 'node:fs';
import path from 'node:path';

const CONF_HEADER = `# AI agents added by ai-agent-sync discovery.
# Format: id|Label|detect paths (colon-separated)|item path|file or dir
# A line here replaces the built-in registry entry with the same id.
`;
const IGNORE_HEADER = `# Folders ai-agent-sync discovery never shows again.
`;

const dataLines = (file) => {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
};

// Parses tools.conf into agents, grouped by id, in file order.
export function readToolsConf(file) {
  const byId = new Map();
  for (const line of dataLines(file)) {
    const [id, name, detect, item, kind] = line.split('|');
    if (!id || !item || (kind !== 'file' && kind !== 'dir')) continue;
    if (!byId.has(id)) byId.set(id, { id, name: name || id, detect: detect.split(':').filter(Boolean), items: [] });
    byId.get(id).items.push({ path: item, kind });
  }
  return [...byId.values()];
}

// Built-in agents with tools.conf entries replacing or extending them.
export function mergeAgents(builtin, fromConf) {
  const confIds = new Set(fromConf.map((a) => a.id));
  return [...builtin.filter((a) => !confIds.has(a.id)), ...fromConf];
}

export const agentToLines = (a) =>
  a.items.map((it) => [a.id, a.name, a.detect.join(':'), it.path, it.kind].join('|'));

function appendOnce(file, lines, header) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, header);
  const have = new Set(dataLines(file));
  const add = lines.filter((l) => !have.has(l));
  if (add.length) fs.appendFileSync(file, add.join('\n') + '\n');
}

export const addToToolsConf = (file, agent) => appendOnce(file, agentToLines(agent), CONF_HEADER);

export const readIgnore = (file) => new Set(dataLines(file));

export const addToIgnore = (file, tildePaths) => appendOnce(file, tildePaths, IGNORE_HEADER);
