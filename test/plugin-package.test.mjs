import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { buildControlPlugin } from '../scripts/integrate-plugin.mjs';

async function sourceProject(root, name) {
  const project = join(root, name);
  await mkdir(join(project, 'plugin'), { recursive: true });
  await copyFile(
    new URL('../plugin/plugin.json', import.meta.url),
    join(project, 'plugin/plugin.json'),
  );
  for (const skill of ['cot', 'cot-on', 'cot-off']) {
    const directory = join(project, 'plugin/skills', skill);
    await mkdir(directory, { recursive: true });
    await copyFile(
      new URL(`../plugin/skills/${skill}/SKILL.md`, import.meta.url),
      join(directory, 'SKILL.md'),
    );
  }
  return project;
}

async function withProjects(callback) {
  const prefix = join(resolve(tmpdir()), 'codex-reasoning-plugin-');
  const root = await mkdtemp(prefix);
  try {
    await callback(root);
  } finally {
    if (!resolve(root).startsWith(prefix)) throw new Error('Unsafe test cleanup path');
    await rm(root, { recursive: true, force: true });
  }
}

test('generated plugin separates executable arguments and contains the three real skills', async () => {
  await withProjects(async (root) => {
    const project = await sourceProject(root, 'project with spaces');
    const state = await buildControlPlugin(project);
    const mcp = JSON.parse(await readFile(join(state.packageRoot, 'mcp.json'), 'utf8'));
    assert.deepEqual(mcp.mcpServers['reasoning-control'], {
      command: process.execPath,
      args: [join(project, 'src/control/server.mjs')],
      env: {},
    });
    for (const name of ['cot', 'cot-on', 'cot-off']) {
      assert.deepEqual(
        await readFile(join(state.packageRoot, 'skills', name, 'SKILL.md')),
        await readFile(join(project, 'plugin/skills', name, 'SKILL.md')),
      );
    }
    await assert.rejects(access(join(project, '.agents')));
    const marketplace = JSON.parse(
      await readFile(join(state.root, '.agents/plugins/marketplace.json'), 'utf8'),
    );
    assert.equal(marketplace.plugins[0].source.path, './plugins/codex-reasoning-viewer');
  });
});

test('rebuilding preserves only the five known viewer environment fields', async () => {
  await withProjects(async (root) => {
    const project = await sourceProject(root, 'project');
    const state = await buildControlPlugin(project);
    const mcpPath = join(state.packageRoot, 'mcp.json');
    const mcp = JSON.parse(await readFile(mcpPath, 'utf8'));
    mcp.mcpServers['reasoning-control'].env = {
      CODEX_REASONING_MODE: 'raw',
      CODEX_REASONING_FOLLOW: 'false',
      CODEX_REASONING_COLLAPSED: 'true',
      CODEX_REASONING_HEIGHT: '900',
      CODEX_REASONING_INDICATOR_COLOR: '#ABCDEF',
      CODEX_REASONING_UNKNOWN: 'drop-me',
      OTHER_ENV: 'drop-me',
    };
    await writeFile(mcpPath, JSON.stringify(mcp, null, 2));

    const rebuilt = await buildControlPlugin(project);
    const result = JSON.parse(await readFile(join(rebuilt.packageRoot, 'mcp.json'), 'utf8'));
    assert.deepEqual(result.mcpServers['reasoning-control'], {
      command: process.execPath,
      args: [join(project, 'src/control/server.mjs')],
      env: {
        CODEX_REASONING_MODE: 'raw',
        CODEX_REASONING_FOLLOW: 'false',
        CODEX_REASONING_COLLAPSED: 'true',
        CODEX_REASONING_HEIGHT: '900',
        CODEX_REASONING_INDICATOR_COLOR: '#ABCDEF',
      },
    });
  });
});

test('different project folders receive distinct local marketplace identities', async () => {
  await withProjects(async (root) => {
    const first = await buildControlPlugin(await sourceProject(root, 'first'));
    const second = await buildControlPlugin(await sourceProject(root, 'second'));
    assert.notEqual(first.marketplace, second.marketplace);
    assert.notEqual(first.plugin, second.plugin);
  });
});
