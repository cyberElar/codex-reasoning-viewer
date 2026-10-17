import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyInstallation, readAsarMembers } from '../src/native/installation.mjs';
async function fixture(members, callback) {
  const root = await mkdtemp(join(tmpdir(), 'native-viewer-guard-'));
  const tree = { files: {} },
    parts = [];
  let offset = 0;
  for (const [name, value] of Object.entries(members)) {
    const bytes = Buffer.from(value);
    let entry = tree;
    const names = name.split('/');
    for (const segment of names.slice(0, -1)) entry = entry.files[segment] ??= { files: {} };
    entry.files[names.at(-1)] = {
      size: bytes.length,
      offset: String(offset),
      integrity: { hash: createHash('sha256').update(bytes).digest('hex') },
    };
    parts.push(bytes);
    offset += bytes.length;
  }
  const header = Buffer.from(JSON.stringify(tree)),
    prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(header.length + 8, 4);
  prefix.writeUInt32LE(header.length, 12);
  const path = join(root, 'app.asar');
  await writeFile(path, Buffer.concat([prefix, header, ...parts]));
  try {
    return await callback({ asar: path });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('unrecognized update disables the native viewer', async () => {
  await fixture(
    { 'package.json': JSON.stringify({ version: '999.0.0' }) },
    async (installation) => {
      const result = await verifyInstallation(installation);
      assert.equal(result.supported, false);
      assert.equal(result.reason, 'Unknown desktop version');
    },
  );
});
test('changed renderer bytes disable the viewer even when the package version matches', async () => {
  const [profile] = JSON.parse(
    await readFile(new URL('../src/native/supported-builds.json', import.meta.url), 'utf8'),
  );
  const members = { 'package.json': JSON.stringify({ version: profile.packageVersion }) };
  for (const asset of profile.assets) members['webview' + asset.path] = 'changed renderer bytes';
  await fixture(members, async (installation) => {
    const result = await verifyInstallation(installation);
    assert.equal(result.supported, false);
    assert.equal(result.reason, 'Changed renderer assets');
  });
});
test('missing native interface assets disable the viewer', async () => {
  const [profile] = JSON.parse(
    await readFile(new URL('../src/native/supported-builds.json', import.meta.url), 'utf8'),
  );
  await fixture(
    { 'package.json': JSON.stringify({ version: profile.packageVersion }) },
    async (installation) => {
      assert.equal((await verifyInstallation(installation)).supported, false);
    },
  );
});
test('ASAR verification refuses corrupted declared member bytes', async () => {
  await fixture({ 'package.json': 'metadata' }, async (installation) => {
    const bytes = await readFile(installation.asar);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(installation.asar, bytes);
    await assert.rejects(
      readAsarMembers(installation.asar, ['package.json']),
      /integrity mismatch/,
    );
  });
});
