import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  settingsFromEnvironment,
  startupSettings,
  validateSettingsPatch,
} from '../src/control/settings.mjs';

const prefix = join(resolve(tmpdir()), 'codex-reasoning-settings-');
const roots = [];

async function temporaryProject() {
  const root = await mkdtemp(prefix);
  roots.push(root);
  return root;
}

test.after(async () => {
  for (const root of roots) {
    if (!resolve(root).startsWith(prefix)) throw new Error('Unsafe test cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});

test('defaults match the documented viewer settings', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    mode: 'auto',
    follow: true,
    collapsed: false,
    height: null,
    indicatorColor: 'auto',
  });
});

test('validated patches accept every documented value', () => {
  const patches = [
    { mode: 'auto' },
    { mode: 'summary' },
    { mode: 'raw' },
    { follow: false },
    { collapsed: true },
    { height: null },
    { height: 64 },
    { height: 1600 },
    { indicatorColor: 'auto' },
    { indicatorColor: '#abc' },
    { indicatorColor: '#ABCD' },
    { indicatorColor: '#012345' },
    { indicatorColor: '#01234567' },
    { mode: 'raw', follow: false, collapsed: true, height: 900, indicatorColor: '#FedCbA98' },
  ];
  for (const patch of patches) assert.deepEqual(validateSettingsPatch(patch), patch);
});

test('patches require at least one own property and reject unknown keys', () => {
  assert.throws(() => validateSettingsPatch({}), /Unknown or empty viewer settings/);
  assert.deepEqual(validateSettingsPatch({}, { allowEmpty: true }), {});
  assert.deepEqual(validateSettingsPatch({ mode: 'raw' }), { mode: 'raw' });

  for (const value of [
    null,
    [],
    'mode=raw',
    42,
    true,
    new Date(),
    JSON.parse('{"__proto__":{"mode":"raw"}}'),
    { unexpected: true },
    { mode: 'raw', unexpected: true },
    { [Symbol('mode')]: 'raw' },
  ]) {
    assert.throws(() => validateSettingsPatch(value), TypeError);
  }

  const bare = Object.create(null);
  bare.mode = 'raw';
  assert.deepEqual(validateSettingsPatch(bare), { mode: 'raw' });
});

test('height and indicator color boundaries are enforced', () => {
  for (const height of [63, 1601, 64.5, -64, NaN, Infinity, '64']) {
    assert.throws(() => validateSettingsPatch({ height }), /Invalid viewer setting: height/);
  }
  for (const indicatorColor of [
    'AUTO',
    'Auto',
    'red',
    'transparent',
    'rgb(0, 0, 0)',
    '#12',
    '#12345',
    '#1234567',
    '#123456789',
    '#ggg',
    '#fff;background:url(javascript:alert(1))',
    '#fff")+window.evil()+("',
  ]) {
    assert.throws(
      () => validateSettingsPatch({ indicatorColor }),
      /Invalid viewer setting: indicatorColor/,
    );
  }
});

test('mode and boolean fields reject coercions', () => {
  for (const patch of [
    { mode: 'RAW' },
    { mode: 'verbose' },
    { mode: true },
    { follow: 'false' },
    { collapsed: 0 },
  ]) {
    assert.throws(() => validateSettingsPatch(patch), /Invalid viewer setting/);
  }
});

test('environment settings parse all fields and trim surrounding whitespace', () => {
  assert.deepEqual(settingsFromEnvironment({}), {});
  assert.deepEqual(
    settingsFromEnvironment({
      CODEX_REASONING_MODE: ' summary ',
      CODEX_REASONING_FOLLOW: 'false',
      CODEX_REASONING_COLLAPSED: 'true',
      CODEX_REASONING_HEIGHT: ' 900 ',
      CODEX_REASONING_INDICATOR_COLOR: ' #ABCDEF ',
    }),
    {
      mode: 'summary',
      follow: false,
      collapsed: true,
      height: 900,
      indicatorColor: '#ABCDEF',
    },
  );
  assert.deepEqual(settingsFromEnvironment({ CODEX_REASONING_HEIGHT: 'auto' }), {
    height: null,
  });
});

test('invalid environment settings are rejected rather than ignored', () => {
  for (const environment of [
    { CODEX_REASONING_MODE: 'RAW' },
    { CODEX_REASONING_MODE: 'verbose' },
    { CODEX_REASONING_FOLLOW: 'yes' },
    { CODEX_REASONING_COLLAPSED: '1' },
    { CODEX_REASONING_HEIGHT: '63' },
    { CODEX_REASONING_HEIGHT: '1601' },
    { CODEX_REASONING_HEIGHT: '1.5' },
    { CODEX_REASONING_HEIGHT: '' },
    { CODEX_REASONING_INDICATOR_COLOR: 'red' },
    { CODEX_REASONING_INDICATOR_COLOR: 'AUTO' },
  ]) {
    assert.throws(() => settingsFromEnvironment(environment), TypeError);
  }
});

test('startup settings omit a null height so a dragged height is preserved', () => {
  assert.deepEqual(startupSettings({ ...DEFAULT_SETTINGS }), {
    mode: 'auto',
    follow: true,
    collapsed: false,
    indicatorColor: 'auto',
  });
  assert.deepEqual(startupSettings({ height: null }), {});
  assert.deepEqual(startupSettings({ height: 64 }), { height: 64 });
  assert.throws(() => startupSettings({}), /Unknown or empty viewer settings/);
});

test('the store uses the fixed settings path and persists defaults', async () => {
  const root = await temporaryProject();
  const store = createSettingsStore(root);
  assert.equal(await store.readSaved(), null);
  assert.deepEqual(await store.read(), DEFAULT_SETTINGS);

  const saved = await store.update({ mode: 'raw', indicatorColor: '#AbC' });
  assert.deepEqual(saved, { ...DEFAULT_SETTINGS, mode: 'raw', indicatorColor: '#AbC' });

  const path = join(root, '.local', 'control-plugin', 'settings.json');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    version: 1,
    settings: saved,
  });
  assert.deepEqual(await createSettingsStore(root).readSaved(), saved);
});

test('invalid saved documents fail closed instead of returning defaults', async () => {
  const root = await temporaryProject();
  const store = createSettingsStore(root);
  const directory = join(root, '.local', 'control-plugin');
  const path = join(directory, 'settings.json');
  await mkdir(directory, { recursive: true });

  for (const document of [
    '{not-json',
    JSON.stringify({ version: 2, settings: DEFAULT_SETTINGS }),
    JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, unexpected: true } }),
    JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, indicatorColor: 'red' } }),
  ]) {
    await writeFile(path, document);
    await assert.rejects(store.readSaved(), /The saved viewer settings are invalid/);
  }

  const valid = JSON.stringify({ version: 1, settings: DEFAULT_SETTINGS });
  await writeFile(path, valid + ' '.repeat(17000 - valid.length));
  await assert.rejects(store.readSaved(), /The saved viewer settings are invalid/);

  await rm(path);
  assert.equal(await store.readSaved(), null);
});

test('concurrent updates are serialized and leave no temporary files', async () => {
  const root = await temporaryProject();
  const store = createSettingsStore(root);
  const results = await Promise.all([
    store.update({ mode: 'raw' }),
    store.update({ follow: false }),
    store.update({ collapsed: true }),
    store.update({ height: 1200 }),
    store.update({ indicatorColor: '#123456' }),
  ]);
  const expected = {
    mode: 'raw',
    follow: false,
    collapsed: true,
    height: 1200,
    indicatorColor: '#123456',
  };
  assert.deepEqual(results.at(-1), expected);
  assert.deepEqual(await store.readSaved(), expected);
  assert.deepEqual(await readdir(join(root, '.local', 'control-plugin')), ['settings.json']);
});

test('readers never observe a partially written settings document', async () => {
  const root = await temporaryProject();
  const store = createSettingsStore(root);
  const samples = [];

  async function reader() {
    for (let index = 0; index < 12; index++) {
      samples.push(await store.read());
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  async function writer() {
    for (let index = 0; index < 12; index++) await store.update({ height: 100 + index });
  }

  await Promise.all([writer(), reader(), reader()]);
  assert.ok(samples.length > 0);
  for (const sample of samples) {
    assert.deepEqual(Object.keys(sample).sort(), Object.keys(DEFAULT_SETTINGS).sort());
    assert.doesNotThrow(() => validateSettingsPatch(sample));
  }
  assert.equal((await store.readSaved()).height, 111);
});

test('startup environment values override only the saved fields they mention', async () => {
  const root = await temporaryProject();
  const store = createSettingsStore(root);
  await store.update({
    mode: 'raw',
    follow: false,
    height: 900,
    indicatorColor: '#abc',
  });

  const settings = await store.initialize({
    CODEX_REASONING_MODE: 'summary',
    CODEX_REASONING_HEIGHT: 'auto',
  });
  assert.deepEqual(settings, {
    mode: 'summary',
    follow: false,
    collapsed: false,
    height: null,
    indicatorColor: '#abc',
  });
  assert.deepEqual(await store.readSaved(), settings);
  assert.deepEqual(await store.initialize({}), settings);
});

test('an invalid startup environment does not alter saved settings', async () => {
  const root = await temporaryProject();
  const store = createSettingsStore(root);
  const saved = await store.update({ collapsed: true, height: 800 });
  await assert.rejects(
    store.initialize({ CODEX_REASONING_INDICATOR_COLOR: 'red' }),
    /Invalid viewer setting: indicatorColor/,
  );
  assert.deepEqual(await store.readSaved(), saved);
});
