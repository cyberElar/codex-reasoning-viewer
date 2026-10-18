import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile),
  project = resolve(import.meta.dirname, '..');
const directories = ['src/native', 'src/control', 'scripts', 'test'];
const files = (
  await Promise.all(
    directories.map(async (directory) =>
      (await readdir(resolve(project, directory), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /\.(?:mjs|js)$/.test(entry.name))
        .map((entry) => resolve(project, directory, entry.name)),
    ),
  )
).flat();
const results = await Promise.allSettled(
  files.map((file) => execute(process.execPath, ['--check', file], { windowsHide: true })),
);
let failed = 0;
for (let index = 0; index < results.length; index++) {
  if (results[index].status === 'rejected') {
    failed++;
    console.error(files[index]);
    console.error(results[index].reason.stderr ?? results[index].reason.message);
  }
}
if (failed) process.exitCode = 1;
else console.log(`Syntax checked ${files.length} JavaScript files.`);
