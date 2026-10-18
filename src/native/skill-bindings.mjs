import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';

export async function readSkillBindings(project) {
  try {
    const raw = await readFile(
      resolve(project, '.local/control-plugin/skill-bindings.json'),
      'utf8',
    );
    if (raw.length > 32768) return [];
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.paths)) return [];
    return value.paths
      .filter(
        (entry) =>
          ['cot', 'cot-on', 'cot-off'].includes(entry?.name) &&
          typeof entry.path === 'string' &&
          isAbsolute(entry.path),
      )
      .map(({ name, path }) => ({ name, path }));
  } catch {
    return [];
  }
}
