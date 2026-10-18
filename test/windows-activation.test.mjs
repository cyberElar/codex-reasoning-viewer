import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { powershell } from '../src/native/installation.mjs';
import {
  CODEX_APPLICATION_ID,
  activatePackagedDesktop,
  createWindowsActivation,
  inspectPackageIdentity,
} from '../src/native/windows-activation.mjs';

const DEBUG_ARGS = ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=43123'];

function fakeActivation(output, { source = '// test source' } = {}) {
  const scripts = [];
  return {
    scripts,
    api: createWindowsActivation({
      readSource: async () => source,
      run: async (script) => {
        scripts.push(script);
        return output;
      },
    }),
  };
}

test(
  'activation manager class factory, CoCreateInstance and QI paths work without ActivateApplication',
  { timeout: 30000 },
  async () => {
    const source = await readFile(
      new URL('../src/native/windows-activation.cs', import.meta.url),
      'utf8',
    );
    const encoded = Buffer.from(source, 'utf8').toString('base64');
    const output = await powershell(`$ErrorActionPreference = 'Stop'
$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
Add-Type -TypeDefinition $source -Language CSharp
[CodexWindowsActivation.Native]::ProbeActivationManager()`);
    assert.equal(
      output.trim(),
      'factory=0x00000000;create=0x00000000;qi=0x00000000;cocreate=0x00000000;cocreateqi=0x00000000',
    );
  },
);

test('activation passes only the known AUMID and validated debugger pair', async () => {
  const { api, scripts } = fakeActivation('{"pid":4242}');
  const pid = await api.activatePackagedDesktop(CODEX_APPLICATION_ID, DEBUG_ARGS);
  assert.equal(pid, 4242);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /Add-Type -TypeDefinition/);
  assert.match(scripts[0], /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(scripts[0], /--remote-debugging-port=43123/);
});

test('activation accepts an empty argument list', async () => {
  const { api } = fakeActivation('{"pid":7}');
  assert.equal(await api.activatePackagedDesktop(CODEX_APPLICATION_ID), 7);
});

test('activation rejects an unknown application ID', async () => {
  const { api } = fakeActivation('{"pid":1}');
  await assert.rejects(
    () => api.activatePackagedDesktop('Other.App_123!App', []),
    /Unsupported packaged application ID/,
  );
});

test('activation rejects malformed or unexpected debugger arguments', async () => {
  const { api } = fakeActivation('{"pid":1}');
  const invalid = [
    '--remote-debugging-address=127.0.0.1',
    ['--remote-debugging-address=127.0.0.1'],
    ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=65536'],
    ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=043123'],
    ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=43123.0'],
    ['--remote-debugging-address=0.0.0.0', '--remote-debugging-port=43123'],
    ['--remote-debugging-port=43123', '--remote-debugging-address=127.0.0.1'],
    ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=43123', '--no-sandbox'],
    ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=43123; Write-Host x'],
    [123, 456],
  ];
  for (const args of invalid) {
    await assert.rejects(
      () => api.activatePackagedDesktop(CODEX_APPLICATION_ID, args),
      /args must|Only the fixed|Unsupported|canonical|out of range/,
      `accepted ${JSON.stringify(args)}`,
    );
  }
});

test('activation rejects runner failures and invalid PIDs', async () => {
  const failing = createWindowsActivation({
    readSource: async () => '// test source',
    run: async () => {
      const error = new Error('runner failed');
      error.stderr = 'Add-Type failed';
      throw error;
    },
  });
  await assert.rejects(
    () => failing.activatePackagedDesktop(CODEX_APPLICATION_ID, DEBUG_ARGS),
    /Package activation failed: Add-Type failed/,
  );

  for (const output of ['{"pid":0}', '{"pid":"42"}', 'not json', '']) {
    const { api } = fakeActivation(output);
    await assert.rejects(
      () => api.activatePackagedDesktop(CODEX_APPLICATION_ID, DEBUG_ARGS),
      /invalid process ID|invalid JSON|no output/,
    );
  }
});

test('package identity inspection validates PID input', async () => {
  const { api } = fakeActivation('{"packaged":false,"packageFullName":null}');
  for (const pid of [0, -1, 1.5, '123', 0x100000000]) {
    await assert.rejects(() => api.inspectPackageIdentity(pid), RangeError);
  }
});

test('package identity inspection maps packaged and unpackaged results', async () => {
  const unpackaged = fakeActivation('{"packaged":false,"packageFullName":null}');
  assert.deepEqual(await unpackaged.api.inspectPackageIdentity(1234), {
    packaged: false,
    packageFullName: null,
  });

  const packaged = fakeActivation(
    '{"packaged":true,"packageFullName":"OpenAI.Codex_26.1013.4894.0_x64__2p2nqsd0c76g0"}',
  );
  assert.deepEqual(await packaged.api.inspectPackageIdentity(1234), {
    packaged: true,
    packageFullName: 'OpenAI.Codex_26.1013.4894.0_x64__2p2nqsd0c76g0',
  });
});

test('package identity inspection rejects inconsistent output', async () => {
  for (const output of [
    '{"packaged":true,"packageFullName":null}',
    '{"packaged":true,"packageFullName":""}',
    '{"packaged":false,"packageFullName":"unexpected"}',
    '{"packaged":"false","packageFullName":null}',
    'not json',
  ]) {
    const { api } = fakeActivation(output);
    await assert.rejects(
      () => api.inspectPackageIdentity(1234),
      /invalid result|no package full name|unexpected package full name|invalid JSON/,
    );
  }
});

test(
  'GetPackageFullName interop compiles and probes the test process',
  { timeout: 30000 },
  async () => {
    const identity = await inspectPackageIdentity(process.pid);
    assert.deepEqual(identity, { packaged: false, packageFullName: null });
  },
);

test(
  'package identity inspection throws for a process that cannot be opened',
  { timeout: 30000 },
  async () => {
    await assert.rejects(
      () => inspectPackageIdentity(0xffffffff),
      /Package identity inspection failed/,
    );
  },
);

test('default exports are the public contract', () => {
  assert.equal(typeof activatePackagedDesktop, 'function');
  assert.equal(typeof inspectPackageIdentity, 'function');
});
