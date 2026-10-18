import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  createSettingsStore,
  SETTINGS_SCHEMA,
  settingsFromEnvironment,
  startupSettings,
  validateSettingsPatch,
} from './settings.mjs';

const TOOL_ACTIONS = Object.freeze({
  viewer_show: 'show',
  viewer_hide: 'hide',
  viewer_toggle: 'toggle',
  viewer_status: 'status',
});
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

let viewerModulePromise;

async function controlViewer(action, settings) {
  viewerModulePromise ??= import('./viewer.mjs');
  const module = await viewerModulePromise;
  if (typeof module.controlViewer !== 'function') {
    throw new TypeError('Viewer control module is unavailable');
  }
  return module.controlViewer(action, settings);
}
const settingsStore = createSettingsStore(resolve(import.meta.dirname, '../..'));

function emptyArgumentSchema() {
  return {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  };
}

function toolDefinitions() {
  return [
    {
      name: 'viewer_show',
      description: 'Show the local reasoning viewer without restarting Codex.',
      inputSchema: emptyArgumentSchema(),
    },
    {
      name: 'viewer_hide',
      description: 'Hide the local reasoning viewer while keeping it running.',
      inputSchema: emptyArgumentSchema(),
    },
    {
      name: 'viewer_toggle',
      description: 'Toggle local reasoning viewer visibility.',
      inputSchema: emptyArgumentSchema(),
    },
    {
      name: 'viewer_status',
      description: 'Return minimal viewer status without reasoning content.',
      inputSchema: emptyArgumentSchema(),
    },
    {
      name: 'viewer_settings',
      description: 'Read saved display settings without reasoning content.',
      inputSchema: emptyArgumentSchema(),
    },
    {
      name: 'viewer_configure',
      description:
        'Save and apply display mode, scroll following, collapsed state, body height, or indicator color. Indicator color auto follows the Codex accent; hex overrides it. A null height restores automatic sizing.',
      inputSchema: SETTINGS_SCHEMA,
    },
  ];
}

function hasEmptyArguments(args) {
  if (args === undefined) return true;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return false;
  const prototype = Object.getPrototypeOf(args);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(args).length === 0;
}

function toolError(text) {
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

function toolSuccess(value, action) {
  const payload = value === undefined ? { ok: true, action } : value;
  const text = JSON.stringify(payload);
  if (typeof text !== 'string') {
    throw new TypeError('Viewer control result is not serializable');
  }
  return { content: [{ type: 'text', text }] };
}

export function createControlServer(control = controlViewer, store = settingsStore) {
  if (typeof control !== 'function') {
    throw new TypeError('Viewer control callback must be a function');
  }

  const server = new Server(
    { name: 'codex-reasoning-viewer-control', version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params?.name;
    if (name === 'viewer_configure') {
      let patch;
      try {
        patch = validateSettingsPatch(request.params?.arguments);
      } catch {
        return toolError(
          'Invalid viewer settings. Use mode, follow, collapsed, height, or indicatorColor.',
        );
      }
      try {
        const settings = await store.update(patch);
        let state;
        try {
          state = await control('configure', patch);
        } catch {
          state = { connected: false, reason: 'connection-unavailable' };
        }
        return toolSuccess({ saved: true, settings, ...state });
      } catch {
        return toolError('Viewer settings could not be saved.');
      }
    }
    if (name === 'viewer_settings') {
      if (!hasEmptyArguments(request.params?.arguments))
        return toolError('Viewer settings read accepts no arguments.');
      try {
        return toolSuccess({ settings: await store.read() });
      } catch {
        return toolError('Viewer settings are unavailable.');
      }
    }
    if (typeof name !== 'string' || !Object.hasOwn(TOOL_ACTIONS, name)) {
      return toolError('Unknown viewer control tool.');
    }
    if (!hasEmptyArguments(request.params?.arguments)) {
      return toolError('Viewer control tools accept no arguments.');
    }

    const action = TOOL_ACTIONS[name];
    let result;
    try {
      result = await control(action);
    } catch {
      return toolError('Viewer control is unavailable.');
    }

    try {
      return toolSuccess(result, action);
    } catch {
      return toolError('Viewer control returned an invalid status.');
    }
  });

  return server;
}

export async function initializeControlSettings(
  control = controlViewer,
  store = settingsStore,
  environment = process.env,
) {
  const environmentSettings = settingsFromEnvironment(environment);
  const settings = await store.initialize(environment);
  const runtime = startupSettings(settings);
  if (Object.hasOwn(environmentSettings, 'height')) runtime.height = environmentSettings.height;
  await control('configure', runtime);
  return settings;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  const invoked = resolve(process.argv[1]);
  const self = fileURLToPath(import.meta.url);
  return process.platform === 'win32'
    ? invoked.toLowerCase() === self.toLowerCase()
    : invoked === self;
}

if (isDirectExecution()) {
  try {
    await initializeControlSettings();
    await createControlServer().connect(new StdioServerTransport());
  } catch {
    process.stderr.write('viewer control server unavailable\n');
    process.exitCode = 1;
  }
}
