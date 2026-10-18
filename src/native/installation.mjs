import { open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join } from 'node:path';
const execute = promisify(execFile);
export async function powershell(script) {
  const { stdout } = await execute(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  return stdout.trim().replace(/^\uFEFF/, '');
}
export async function findInstallation(run = powershell) {
  const output = await run(`
    $package=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1;
    if($package){
      $manifest=Get-AppxPackageManifest -Package $package.PackageFullName -ErrorAction Stop;
      $application=@($manifest.Package.Applications.Application) | Where-Object {
        ([string]$_.Executable).Replace('\\','/') -eq 'app/ChatGPT.exe'
      } | Select-Object -First 1;
      if(!$application){throw 'The registered Codex application entry was not found'};
      [pscustomobject]@{
        directory=$package.InstallLocation;
        applicationId=$package.PackageFamilyName+'!'+$application.Id;
        packageFullName=$package.PackageFullName
      } | ConvertTo-Json -Compress
    }`);
  if (!output) throw new Error('The installed OpenAI.Codex package was not found.');
  const metadata = JSON.parse(output);
  if (
    typeof metadata?.directory !== 'string' ||
    !isAbsolute(metadata.directory) ||
    typeof metadata.applicationId !== 'string' ||
    !metadata.applicationId.includes('!') ||
    typeof metadata.packageFullName !== 'string' ||
    !metadata.packageFullName
  )
    throw new Error('The installed Codex activation metadata is invalid.');
  return {
    directory: metadata.directory,
    applicationId: metadata.applicationId,
    packageFullName: metadata.packageFullName,
    executable: join(metadata.directory, 'app', 'ChatGPT.exe'),
    asar: join(metadata.directory, 'app', 'resources', 'app.asar'),
  };
}
export async function readAsarMembers(path, names) {
  const handle = await open(path, 'r');
  try {
    const prefix = Buffer.alloc(16);
    await handle.read(prefix, 0, 16, 0);
    const size = prefix.readUInt32LE(12);
    if (size > 32 * 1024 * 1024) throw new Error('Unexpected ASAR header size.');
    const bytes = Buffer.alloc(size);
    await handle.read(bytes, 0, size, 16);
    const header = JSON.parse(bytes.toString('utf8')),
      base = 8 + prefix.readUInt32LE(4),
      result = {};
    for (const name of names) {
      let entry = header;
      for (const part of name.split('/')) entry = entry?.files?.[part];
      if (!entry || entry.unpacked || !Number.isSafeInteger(entry.size))
        throw new Error('Missing expected bundled member: ' + name);
      const content = Buffer.alloc(entry.size);
      const read = await handle.read(content, 0, content.length, base + Number(entry.offset));
      if (read.bytesRead !== content.length) throw new Error('Incomplete ASAR member.');
      const sha256 = createHash('sha256').update(content).digest('hex');
      if (entry.integrity?.hash && entry.integrity.hash !== sha256)
        throw new Error('ASAR member integrity mismatch.');
      result[name] = { content, sha256 };
    }
    return result;
  } finally {
    await handle.close();
  }
}
export async function verifyInstallation(installation) {
  const supported = JSON.parse(
    await readFile(new URL('./supported-builds.json', import.meta.url), 'utf8'),
  );
  const metadata = await readAsarMembers(installation.asar, ['package.json']);
  const pkg = JSON.parse(metadata['package.json'].content.toString('utf8'));
  const candidate = supported.find((x) => x.packageVersion === pkg.version);
  if (!candidate)
    return { supported: false, version: pkg.version, reason: 'Unknown desktop version' };
  try {
    const files = await readAsarMembers(
      installation.asar,
      candidate.assets.map((x) => 'webview' + x.path),
    );
    const mismatch = candidate.assets.find((x) => files['webview' + x.path].sha256 !== x.sha256);
    if (mismatch)
      return { supported: false, version: pkg.version, reason: 'Changed renderer assets' };
    return { supported: true, version: pkg.version, profile: candidate };
  } catch {
    return {
      supported: false,
      version: pkg.version,
      reason: 'Expected renderer interface unavailable',
    };
  }
}
export async function runningDesktopProcesses() {
  const output = await powershell(
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -like '*\\WindowsApps\\OpenAI.Codex_*' } | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
  );
  if (!output) return [];
  const rows = JSON.parse(output);
  return Array.isArray(rows) ? rows : [rows];
}
