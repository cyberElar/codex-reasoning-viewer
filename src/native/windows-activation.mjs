import { readFile } from 'node:fs/promises';
import { powershell } from './installation.mjs';

export const CODEX_APPLICATION_ID = 'OpenAI.Codex_2p2nqsd0c76g0!App';
const DEBUG_ADDRESS_ARGUMENT = '--remote-debugging-address=127.0.0.1';
const DEBUG_PORT_PREFIX = '--remote-debugging-port=';
const MAX_UINT32 = 0xffffffff;
const sourceUrl = new URL('./windows-activation.cs', import.meta.url);
const readActivationSource = () => readFile(sourceUrl, 'utf8');

const quotePowerShell = (value) => "'" + value.replaceAll("'", "''") + "'";

function assertApplicationId(applicationId) {
  if (applicationId !== CODEX_APPLICATION_ID)
    throw new Error('Unsupported packaged application ID');
}

function validateDebugArguments(args) {
  if (!Array.isArray(args)) throw new TypeError('args must be an array');
  if (args.length === 0) return '';
  if (args.length !== 2) throw new Error('Only the fixed Codex debugger arguments are supported');
  const [address, port] = args;
  if (address !== DEBUG_ADDRESS_ARGUMENT) throw new Error('Unsupported debugger address argument');
  if (typeof port !== 'string' || !port.startsWith(DEBUG_PORT_PREFIX))
    throw new Error('Unsupported debugger port argument');
  const portText = port.slice(DEBUG_PORT_PREFIX.length);
  if (!/^[1-9]\d{0,4}$/.test(portText))
    throw new Error('Debugger port must be a canonical integer');
  const portNumber = Number(portText);
  if (portNumber < 1 || portNumber > 65535) throw new Error('Debugger port is out of range');
  return address + ' ' + port;
}

function assertPid(pid) {
  if (!Number.isInteger(pid) || pid < 1 || pid > MAX_UINT32)
    throw new RangeError('pid must be a positive 32-bit integer');
}

async function buildScript(readSource, body) {
  const source = await readSource();
  if (typeof source !== 'string' || source.trim() === '')
    throw new Error('Windows activation C# source is empty');
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return `$ErrorActionPreference = 'Stop'
if (-not ('CodexWindowsActivation.Native' -as [type])) {
  $source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${quotePowerShell(encoded)}))
  Add-Type -TypeDefinition $source -Language CSharp
}
${body}`;
}

async function runPowerShell(run, script, action) {
  try {
    return await run(script);
  } catch (error) {
    const stderr =
      typeof error?.stderr === 'string' ? error.stderr : (error?.stderr?.toString?.() ?? '');
    const detail = stderr.trim() || error?.message || String(error);
    const firstLine = detail.split(/\r?\n/).find((line) => line.trim()) ?? 'unknown error';
    throw new Error(`${action} failed: ${firstLine.slice(0, 500)}`, { cause: error });
  }
}

function parseJson(output, action) {
  if (typeof output !== 'string' || output.trim() === '')
    throw new Error(`${action} returned no output`);
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${action} returned invalid JSON`, { cause: error });
  }
}

export function createWindowsActivation({
  run = powershell,
  readSource = readActivationSource,
} = {}) {
  if (typeof run !== 'function') throw new TypeError('run must be a function');
  if (typeof readSource !== 'function') throw new TypeError('readSource must be a function');

  async function activatePackagedDesktop(applicationId, args = []) {
    assertApplicationId(applicationId);
    const argumentString = validateDebugArguments(args);
    const script = await buildScript(
      readSource,
      `$activatedPid = [CodexWindowsActivation.Native]::Activate(${quotePowerShell(applicationId)}, ${quotePowerShell(argumentString)})
[pscustomobject]@{ pid = [int64]$activatedPid } | ConvertTo-Json -Compress`,
    );
    const output = await runPowerShell(run, script, 'Package activation');
    const value = parseJson(output, 'Package activation');
    if (!Number.isInteger(value?.pid) || value.pid < 1 || value.pid > MAX_UINT32)
      throw new Error('Package activation returned an invalid process ID');
    return value.pid;
  }

  async function inspectPackageIdentity(pid) {
    assertPid(pid);
    const script = await buildScript(
      readSource,
      `$packageFullName = $null
$packaged = [CodexWindowsActivation.Native]::TryGetPackageFullName([uint32]${pid}, [ref]$packageFullName)
[pscustomobject]@{ packaged = [bool]$packaged; packageFullName = $packageFullName } | ConvertTo-Json -Compress`,
    );
    const output = await runPowerShell(run, script, 'Package identity inspection');
    const value = parseJson(output, 'Package identity inspection');
    if (typeof value?.packaged !== 'boolean')
      throw new Error('Package identity inspection returned an invalid result');
    if (value.packaged) {
      if (typeof value.packageFullName !== 'string' || value.packageFullName === '')
        throw new Error('Packaged process returned no package full name');
      return { packaged: true, packageFullName: value.packageFullName };
    }
    if (value.packageFullName !== null)
      throw new Error('Unpackaged process returned an unexpected package full name');
    return { packaged: false, packageFullName: null };
  }

  return { activatePackagedDesktop, inspectPackageIdentity };
}

const defaultActivation = createWindowsActivation();

export const activatePackagedDesktop = defaultActivation.activatePackagedDesktop;
export const inspectPackageIdentity = defaultActivation.inspectPackageIdentity;
