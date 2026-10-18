import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { powershell } from '../src/native/installation.mjs';

export async function buildControlPlugin(project, nodePath = process.execPath) {
  project = resolve(project);
  const root = join(project, '.local/control-plugin');
  const packageRoot = join(root, 'plugins/codex-reasoning-viewer');
  const identity = createHash('sha256').update(project.toLowerCase()).digest('hex').slice(0, 8);
  const marketplace = 'codex-reasoning-controls-' + identity;
  const plugin = 'codex-reasoning-viewer@' + marketplace;
  await mkdir(join(root, '.agents/plugins'), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await copyFile(join(project, 'plugin/plugin.json'), join(packageRoot, 'plugin.json'));
  for (const name of ['cot', 'cot-on', 'cot-off']) {
    const directory = join(packageRoot, 'skills', name);
    await mkdir(directory, { recursive: true });
    await copyFile(join(project, 'plugin/skills', name, 'SKILL.md'), join(directory, 'SKILL.md'));
  }
  const config = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      'reasoning-control': {
        command: nodePath,
        args: [join(project, 'src/control/server.mjs')],
      },
    },
  };
  await writeFile(join(packageRoot, 'mcp.json'), JSON.stringify(config, null, 2) + '\n');
  await writeFile(
    join(root, '.agents/plugins/marketplace.json'),
    JSON.stringify(
      {
        name: marketplace,
        interface: { displayName: 'Local Reasoning Viewer Controls' },
        plugins: [
          {
            name: 'codex-reasoning-viewer',
            source: { source: 'local', path: './plugins/codex-reasoning-viewer' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  const state = { project, root, packageRoot, marketplace, plugin, nodePath };
  await writeFile(join(root, 'installation.json'), JSON.stringify(state, null, 2) + '\n');
  return state;
}

const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
async function writeBindings(state, installedPath) {
  const roots = [join(state.project, 'plugin'), state.packageRoot];
  if (installedPath) roots.push(resolve(installedPath));
  const paths = [];
  for (const name of ['cot', 'cot-on', 'cot-off']) {
    const expected = await readFile(join(state.project, 'plugin/skills', name, 'SKILL.md'));
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    for (const root of roots) {
      const path = join(root, 'skills', name, 'SKILL.md');
      try {
        if (hash(await readFile(path)) !== hash(expected)) continue;
        paths.push({ name, path }, { name, path: await realpath(path) });
      } catch {}
    }
  }
  const unique = [...new Map(paths.map((entry) => [entry.path.toLowerCase(), entry])).values()];
  await writeFile(
    join(state.root, 'skill-bindings.json'),
    JSON.stringify({ version: 1, paths: unique }, null, 2),
  );
  return unique.length;
}
async function codex(args) {
  return powershell(
    '& codex.cmd ' +
      args.map(quote).join(' ') +
      '; if ($LASTEXITCODE -ne 0) { throw "The Codex plugin command failed" }',
  );
}

async function main() {
  const project = resolve(import.meta.dirname, '..');
  if (process.argv.includes('--remove')) {
    const state = JSON.parse(
      await readFile(join(project, '.local/control-plugin/installation.json'), 'utf8'),
    );
    if (resolve(state.project).toLowerCase() !== project.toLowerCase())
      throw new Error('Plugin state belongs to another project');
    const expected =
      'codex-reasoning-controls-' +
      createHash('sha256').update(project.toLowerCase()).digest('hex').slice(0, 8);
    if (state.marketplace !== expected || state.plugin !== 'codex-reasoning-viewer@' + expected)
      throw new Error('Unexpected plugin identity');
    await codex(['plugin', 'remove', state.plugin]);
    await codex(['plugin', 'marketplace', 'remove', state.marketplace]);
    await writeFile(
      join(project, '.local/control-plugin/skill-bindings.json'),
      JSON.stringify({ version: 1, paths: [] }),
    );
    console.log(JSON.stringify({ removed: state.plugin }));
    return;
  }
  const state = await buildControlPlugin(project);
  let installedPath = null;
  if (!process.argv.includes('--build-only')) {
    await codex(['plugin', 'marketplace', 'add', state.root, '--json']);
    const result = JSON.parse(await codex(['plugin', 'add', state.plugin, '--json']));
    if (typeof result.installedPath !== 'string')
      throw new Error('The CLI did not report a plugin path');
    installedPath = result.installedPath;
  }
  const installed = !process.argv.includes('--build-only');
  const skillBindings = await writeBindings(state, installedPath);
  await writeFile(
    join(state.root, 'installation.json'),
    JSON.stringify({ ...state, installed, installedPath }, null, 2),
  );
  console.log(JSON.stringify({ ...state, installed, installedPath, skillBindings }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
