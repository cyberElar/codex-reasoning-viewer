import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'auto',
  follow: true,
  collapsed: false,
  height: null,
  indicatorColor: 'auto',
});
export const SETTINGS_ENV = Object.freeze({
  mode: 'CODEX_REASONING_MODE',
  follow: 'CODEX_REASONING_FOLLOW',
  collapsed: 'CODEX_REASONING_COLLAPSED',
  height: 'CODEX_REASONING_HEIGHT',
  indicatorColor: 'CODEX_REASONING_INDICATOR_COLOR',
});
export const SETTINGS_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['auto', 'summary', 'raw'] },
    follow: { type: 'boolean' },
    collapsed: { type: 'boolean' },
    height: { anyOf: [{ type: 'integer', minimum: 64, maximum: 1600 }, { type: 'null' }] },
    indicatorColor: {
      type: 'string',
      pattern: '^(auto|#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))$',
    },
  },
  minProperties: 1,
  additionalProperties: false,
};

export function validateSettingsPatch(value, { allowEmpty = false } = {}) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError('Viewer settings must be an object');
  const keys = Reflect.ownKeys(value);
  if ((!allowEmpty && !keys.length) || keys.some((key) => !Object.hasOwn(DEFAULT_SETTINGS, key)))
    throw new TypeError('Unknown or empty viewer settings');
  const result = {};
  for (const key of keys) {
    const item = value[key];
    if (
      (key === 'mode' && !['auto', 'summary', 'raw'].includes(item)) ||
      (['follow', 'collapsed'].includes(key) && typeof item !== 'boolean') ||
      (key === 'height' &&
        item !== null &&
        (!Number.isInteger(item) || item < 64 || item > 1600)) ||
      (key === 'indicatorColor' &&
        (typeof item !== 'string' ||
          (item !== 'auto' && !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(item))))
    )
      throw new TypeError('Invalid viewer setting: ' + key);
    result[key] = item;
  }
  return result;
}

export function settingsFromEnvironment(environment) {
  const patch = {};
  for (const [key, name] of Object.entries(SETTINGS_ENV)) {
    if (environment[name] === undefined) continue;
    const text = String(environment[name]).trim();
    if (key === 'mode' || key === 'indicatorColor') patch[key] = text;
    else if (key === 'height')
      patch.height = text === 'auto' ? null : /^\d+$/.test(text) ? Number(text) : NaN;
    else if (text === 'true' || text === 'false') patch[key] = text === 'true';
    else throw new TypeError('Invalid viewer environment setting: ' + name);
  }
  return validateSettingsPatch(patch, { allowEmpty: true });
}

export function startupSettings(settings) {
  const patch = validateSettingsPatch(settings);
  // An unspecified height preserves the user's saved mouse-resize preference.
  if (patch.height === null) delete patch.height;
  return patch;
}

export function createSettingsStore(project) {
  const path = resolve(project, '.local/control-plugin/settings.json');
  let pending = Promise.resolve();
  async function readSaved() {
    try {
      if ((await stat(path)).size > 16384) throw new Error('Viewer settings file is too large');
      const document = JSON.parse(await readFile(path, 'utf8'));
      if (document.version !== 1) throw new Error('Unsupported viewer settings version');
      return {
        ...DEFAULT_SETTINGS,
        ...validateSettingsPatch(document.settings, { allowEmpty: true }),
      };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('The saved viewer settings are invalid');
    }
  }
  async function read() {
    return (await readSaved()) ?? { ...DEFAULT_SETTINGS };
  }
  function update(value) {
    const patch = validateSettingsPatch(value);
    const operation = pending.then(async () => {
      const settings = { ...(await read()), ...patch };
      await mkdir(dirname(path), { recursive: true });
      const temporary = path + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, settings }, null, 2) + '\n', {
          mode: 0o600,
        });
        // Windows readers and scanners can briefly deny replacement; keep the write atomic.
        for (let attempt = 0; ; attempt++) {
          try {
            await rename(temporary, path);
            break;
          } catch (error) {
            if (attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
            await wait(Math.min(10 * 2 ** attempt, 200));
          }
        }
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
      return settings;
    });
    pending = operation.catch(() => {});
    return operation;
  }
  return {
    read,
    readSaved,
    update,
    async initialize(environment) {
      const patch = settingsFromEnvironment(environment);
      return Object.keys(patch).length ? update(patch) : read();
    },
  };
}
