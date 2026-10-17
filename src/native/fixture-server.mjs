import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const FIXTURE_MODEL = 'viewer-fixture';
export const FIXTURE_MODES = Object.freeze(['both', 'raw-only', 'summary-only']);
export const FIXTURE_TEXT = Object.freeze({
  raw: [
    'VIEWER_FIXTURE_RAW_1: synthetic reasoning for the native viewer.',
    'VIEWER_FIXTURE_RAW_2: no external model request is made.',
    'VIEWER_FIXTURE_RAW_3: end of raw stream.',
  ].join('\n'),
  summary: [
    'VIEWER_FIXTURE_SUMMARY_1: synthetic reasoning summary for the native viewer.',
    'VIEWER_FIXTURE_SUMMARY_2: end of summary stream.',
  ].join('\n'),
  final: 'VIEWER_FIXTURE_FINAL: synthetic assistant output completed locally.',
});

const HOST = '127.0.0.1';
const DEFAULT_CHUNK_DELAY_MS = 100;
const DEFAULT_CHUNK_CHARACTERS = 28;
const DEFAULT_METADATA_FILE = 'fixture-server.json';
const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const USAGE = `Usage: node src/native/fixture-server.mjs [options]

Options:
  --fixture both|raw-only|summary-only  Reasoning channels to stream (default: both)
  --delay-ms 100                       Delay between SSE text deltas
  --port 0                             Listen port (0 selects an ephemeral port; 1-65535 explicit)
  --project <directory>                Project root; metadata is written under its .local directory
  --metadata fixture-server.json       Metadata file name under .local
  -h, --help                           Show this help
`;

export async function startFixtureServer(options = {}) {
  const settings = await normalizeOptions(options);
  const activeControllers = new Set();
  const server = createServer((request, response) => {
    handleRequest(request, response, settings, activeControllers).catch((error) => {
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: { code: 'fixture_error', message: 'fixture request failed' },
        });
      } else if (!response.destroyed) {
        response.destroy(error);
      }
    });
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(settings.port, HOST);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server, activeControllers);
    throw new Error('fixture server did not expose a TCP port');
  }

  const port = address.port;
  const metadata = {
    version: 1,
    fixture: settings.fixture,
    model: FIXTURE_MODEL,
    host: HOST,
    port,
    baseUrl: `http://${HOST}:${port}/v1`,
    responsesUrl: `http://${HOST}:${port}/v1/responses`,
    chunkDelayMs: settings.chunkDelayMs,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  try {
    await writeMetadata(settings.metadataPath, metadata);
  } catch (error) {
    await closeServer(server, activeControllers);
    throw error;
  }

  let closePromise;
  const close = () => {
    closePromise ??= (async () => {
      await closeServer(server, activeControllers);
      await rm(settings.metadataPath, { force: true });
    })();
    return closePromise;
  };

  return {
    server,
    host: HOST,
    port,
    baseUrl: metadata.baseUrl,
    responsesUrl: metadata.responsesUrl,
    metadataPath: settings.metadataPath,
    fixture: settings.fixture,
    chunkDelayMs: settings.chunkDelayMs,
    model: FIXTURE_MODEL,
    close,
  };
}

async function normalizeOptions(options) {
  const fixture = options.fixture ?? 'both';
  if (!FIXTURE_MODES.includes(fixture)) {
    throw new Error(`Invalid fixture mode: ${String(fixture)}`);
  }

  const chunkDelayMs = options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
  if (!Number.isInteger(chunkDelayMs) || chunkDelayMs < 0 || chunkDelayMs > 10_000) {
    throw new Error('chunkDelayMs must be an integer between 0 and 10000');
  }

  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('port must be an integer between 0 and 65535');
  }

  const metadataFile = options.metadataFile ?? DEFAULT_METADATA_FILE;
  if (typeof metadataFile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(metadataFile)) {
    throw new Error('metadataFile must be a file name without path separators');
  }

  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const projectInfo = await stat(projectRoot);
  if (!projectInfo.isDirectory()) {
    throw new Error('projectRoot must be a directory');
  }

  return {
    fixture,
    port,
    chunkDelayMs,
    chunkCharacters: DEFAULT_CHUNK_CHARACTERS,
    projectRoot,
    metadataPath: join(projectRoot, '.local', metadataFile),
  };
}

async function writeMetadata(metadataPath, metadata) {
  const localDirectory = dirname(metadataPath);
  await mkdir(localDirectory, { recursive: true });
  const localInfo = await lstat(localDirectory);
  if (!localInfo.isDirectory() || localInfo.isSymbolicLink()) {
    throw new Error('metadata directory must be a real .local directory');
  }

  const temporaryPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, metadataPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function handleRequest(request, response, settings, activeControllers) {
  let pathname;
  try {
    pathname = new URL(request.url ?? '/', `http://${HOST}`).pathname;
  } catch {
    sendJson(response, 400, { error: { code: 'invalid_url', message: 'invalid request URL' } });
    return;
  }
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');

  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, { ok: true, model: FIXTURE_MODEL, fixture: settings.fixture });
    return;
  }

  if (pathname !== '/responses' && pathname !== '/v1/responses') {
    sendJson(response, 404, {
      error: { code: 'not_found', message: 'fixture endpoint not found' },
    });
    return;
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: { code: 'method_not_allowed', message: 'POST required' } });
    return;
  }

  request.resume();
  const controller = new AbortController();
  activeControllers.add(controller);
  const abortOnClose = () => {
    if (!response.writableEnded) controller.abort();
  };
  response.once('close', abortOnClose);
  try {
    await streamFixture(response, settings, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return;
    throw error;
  } finally {
    response.off('close', abortOnClose);
    activeControllers.delete(controller);
  }
}

async function streamFixture(response, settings, signal) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  response.socket?.setNoDelay?.(true);

  const includeSummary = settings.fixture !== 'raw-only';
  const includeRaw = settings.fixture !== 'summary-only';
  const suffix = randomUUID().replaceAll('-', '');
  const responseId = `resp_viewer_fixture_${suffix}`;
  const reasoningId = `rs_viewer_fixture_${suffix}`;
  const messageId = `msg_viewer_fixture_${suffix}`;
  const createdAt = Math.floor(Date.now() / 1000);
  let sequenceNumber = 1;

  const emit = (type, fields = {}) => {
    if (signal.aborted || response.destroyed || response.writableEnded) {
      throw new Error('fixture client disconnected');
    }
    const event = { type, ...fields, sequence_number: sequenceNumber++ };
    response.write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const responseSnapshot = (status, output, usage = null, completedAt = null) => ({
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    completed_at: completedAt,
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: FIXTURE_MODEL,
    output,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: 'high', summary: includeSummary ? 'auto' : null },
    service_tier: 'default',
    store: false,
    temperature: 1,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
    truncation: 'disabled',
    usage,
    user: null,
    metadata: { fixture: FIXTURE_MODEL },
  });

  const reasoningAdded = {
    id: reasoningId,
    type: 'reasoning',
    summary: [],
    ...(includeRaw ? { content: [] } : {}),
  };
  const reasoningDone = {
    id: reasoningId,
    type: 'reasoning',
    summary: includeSummary ? [{ type: 'summary_text', text: FIXTURE_TEXT.summary }] : [],
    ...(includeRaw ? { content: [{ type: 'reasoning_text', text: FIXTURE_TEXT.raw }] } : {}),
  };
  const messageAdded = {
    id: messageId,
    type: 'message',
    role: 'assistant',
    status: 'in_progress',
    content: [],
  };
  const messageDone = {
    id: messageId,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: FIXTURE_TEXT.final, annotations: [], logprobs: [] }],
  };

  emit('response.created', { response: responseSnapshot('in_progress', []) });
  emit('response.in_progress', { response: responseSnapshot('in_progress', []) });
  emit('response.output_item.added', { output_index: 0, item: reasoningAdded });

  if (includeSummary) {
    emit('response.reasoning_summary_part.added', {
      item_id: reasoningId,
      output_index: 0,
      summary_index: 0,
      part: { type: 'summary_text', text: '' },
    });
    await emitDeltas(
      'response.reasoning_summary_text.delta',
      { item_id: reasoningId, output_index: 0, summary_index: 0 },
      FIXTURE_TEXT.summary,
      settings,
      signal,
      emit,
    );
    emit('response.reasoning_summary_text.done', {
      item_id: reasoningId,
      output_index: 0,
      summary_index: 0,
      text: FIXTURE_TEXT.summary,
    });
    emit('response.reasoning_summary_part.done', {
      item_id: reasoningId,
      output_index: 0,
      summary_index: 0,
      part: { type: 'summary_text', text: FIXTURE_TEXT.summary },
    });
  }

  if (includeRaw) {
    emit('response.content_part.added', {
      item_id: reasoningId,
      output_index: 0,
      content_index: 0,
      part: { type: 'reasoning_text', text: '' },
    });
    await emitDeltas(
      'response.reasoning_text.delta',
      { item_id: reasoningId, output_index: 0, content_index: 0 },
      FIXTURE_TEXT.raw,
      settings,
      signal,
      emit,
    );
    emit('response.reasoning_text.done', {
      item_id: reasoningId,
      output_index: 0,
      content_index: 0,
      text: FIXTURE_TEXT.raw,
    });
    emit('response.content_part.done', {
      item_id: reasoningId,
      output_index: 0,
      content_index: 0,
      part: { type: 'reasoning_text', text: FIXTURE_TEXT.raw },
    });
  }

  emit('response.output_item.done', { output_index: 0, item: reasoningDone });
  emit('response.output_item.added', { output_index: 1, item: messageAdded });
  emit('response.content_part.added', {
    item_id: messageId,
    output_index: 1,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [], logprobs: [] },
  });
  await emitDeltas(
    'response.output_text.delta',
    { item_id: messageId, output_index: 1, content_index: 0, logprobs: [] },
    FIXTURE_TEXT.final,
    settings,
    signal,
    emit,
  );
  emit('response.output_text.done', {
    item_id: messageId,
    output_index: 1,
    content_index: 0,
    text: FIXTURE_TEXT.final,
    logprobs: [],
  });
  emit('response.content_part.done', {
    item_id: messageId,
    output_index: 1,
    content_index: 0,
    part: { type: 'output_text', text: FIXTURE_TEXT.final, annotations: [], logprobs: [] },
  });
  emit('response.output_item.done', { output_index: 1, item: messageDone });

  emit('response.completed', {
    response: responseSnapshot(
      'completed',
      [reasoningDone, messageDone],
      {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      Math.floor(Date.now() / 1000),
    ),
  });
  response.end();
}

async function emitDeltas(type, base, text, settings, signal, emit) {
  for (const delta of splitText(text, settings.chunkCharacters)) {
    await wait(settings.chunkDelayMs, undefined, { signal });
    emit(type, { ...base, delta });
  }
}

function splitText(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

async function closeServer(server, activeControllers) {
  for (const controller of activeControllers) controller.abort();
  if (!server.listening) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') rejectClose(error);
      else resolveClose();
    });
    server.closeAllConnections?.();
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      fixture: { type: 'string', default: 'both' },
      'delay-ms': { type: 'string' },
      port: { type: 'string' },
      project: { type: 'string' },
      metadata: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const instance = await startFixtureServer({
    fixture: values.fixture,
    chunkDelayMs: values['delay-ms'] === undefined ? undefined : Number(values['delay-ms']),
    port: values.port === undefined ? undefined : Number(values.port),
    projectRoot: values.project,
    metadataFile: values.metadata,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        model: instance.model,
        fixture: instance.fixture,
        port: instance.port,
        baseUrl: instance.baseUrl,
        responsesUrl: instance.responsesUrl,
        metadataPath: instance.metadataPath,
        chunkDelayMs: instance.chunkDelayMs,
      },
      null,
      2,
    )}\n`,
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await instance.close();
    } catch (error) {
      console.error(`fixture shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`fixture server failed: ${error.message}`);
    process.exitCode = 1;
  });
}
