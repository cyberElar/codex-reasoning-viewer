import { mkdir, readFile, writeFile, copyFile, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { findInstallation, powershell } from '../src/native/installation.mjs';

const project = resolve(import.meta.dirname, '..'),
  stateDir = join(project, '.local/native-integration'),
  manifestPath = join(stateDir, 'shortcuts.json');
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const paths = JSON.parse(
  await powershell(
    "[pscustomobject]@{Desktop=[Environment]::GetFolderPath('Desktop');Programs=(Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs');Wscript=(Join-Path $env:SystemRoot 'System32\\wscript.exe')} | ConvertTo-Json -Compress",
  ),
);
const scriptPath = join(project, 'Launch Codex.vbs'),
  argumentsText = '"' + scriptPath + '" "' + process.execPath + '"';
const normalize = (value) => resolve(value).toLowerCase();
const allowedDirectories = new Set([paths.Desktop, paths.Programs].map(normalize));
async function inspect(path) {
  const output = await powershell(
    `if(Test-Path -LiteralPath ${quote(path)}){$shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut(${quote(path)});[pscustomobject]@{target=$link.TargetPath;arguments=$link.Arguments}|ConvertTo-Json -Compress}`,
  );
  return output ? JSON.parse(output) : null;
}
function isOwned(link) {
  return (
    link && normalize(link.target) === normalize(paths.Wscript) && link.arguments === argumentsText
  );
}
if (process.argv.includes('--remove')) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (normalize(manifest.project) !== normalize(project))
    throw new Error('Shortcut manifest belongs to another project');
  const removed = [],
    preserved = [];
  for (const entry of manifest.entries) {
    const path = resolve(entry.path);
    if (!allowedDirectories.has(normalize(dirname(path))))
      throw new Error('Shortcut path is outside the expected user folders');
    const current = await inspect(path);
    if (isOwned(current)) {
      await unlink(path);
      removed.push(path);
    } else if (current) preserved.push(path);
  }
  await writeFile(
    manifestPath,
    JSON.stringify(
      { ...manifest, removedAt: new Date().toISOString(), removed, preserved },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ removed, preserved }, null, 2));
} else {
  const installation = await findInstallation();
  await mkdir(stateDir, { recursive: true });
  const iconPath = join(stateDir, 'codex.ico');
  await copyFile(join(installation.directory, 'app/resources/icon-chatgpt.ico'), iconPath);
  const entries = [];
  for (const directory of [paths.Desktop, paths.Programs]) {
    if (!directory) throw new Error('The expected user shortcut folder is unavailable');
    let path;
    for (const name of ['Codex.lnk', 'Codex (Thinking).lnk', 'Codex (Local Thinking).lnk']) {
      const candidate = join(directory, name),
        current = await inspect(candidate);
      if (!current || isOwned(current)) {
        path = candidate;
        break;
      }
    }
    if (!path) throw new Error('The shortcut names are already used by other applications');
    await powershell(
      `$shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut(${quote(path)});$link.TargetPath=${quote(paths.Wscript)};$link.Arguments=${quote(argumentsText)};$link.WorkingDirectory=${quote(project)};$link.IconLocation=${quote(iconPath + ',0')};$link.Description='Codex with local reasoning viewer';$link.WindowStyle=1;$link.Save()`,
    );
    const current = await inspect(path);
    if (!isOwned(current) || current.arguments !== argumentsText)
      throw new Error('Shortcut verification failed');
    entries.push({ path, target: paths.Wscript, arguments: argumentsText, icon: iconPath });
  }
  const manifest = {
    installedAt: new Date().toISOString(),
    project,
    nodePath: process.execPath,
    entries,
    installedPackageModified: false,
    windowsLogonStartupChanged: false,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}
