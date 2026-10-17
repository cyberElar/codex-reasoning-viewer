import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileFunction } from 'node:vm';
import { parse } from 'acorn';

const source = await readFile(new URL('../src/native/panel.js', import.meta.url), 'utf8');
const factory = parse(source, { ecmaVersion: 'latest' }).body[0].expression.callee;
const resolver = factory.body.body.find(
  (node) => node.type === 'FunctionDeclaration' && node.id.name === 'composerTarget',
);
assert.ok(resolver, 'the panel must expose its composer resolver');
const choose = compileFunction(`return (${source.slice(resolver.start, resolver.end)})();`, [
  'document',
  'getComputedStyle',
]);

function composer({ visible = true, threadId = null, portalVisible = false } = {}) {
  const editor = { getClientRects: () => (visible ? [{}] : []) };
  const root = { getClientRects: () => (visible ? [{}] : []), querySelector: () => editor };
  const portal = {
    getClientRects: () => (visible && portalVisible ? [{}] : []),
    closest: () => root,
    hasAttribute: () => threadId !== null,
  };
  return {
    portal,
    setVisible(value) {
      visible = value;
    },
  };
}
function select(composers) {
  return choose({ querySelectorAll: () => composers.map((item) => item.portal) }, () => ({
    visibility: 'visible',
  }));
}

test('an empty hidden portal belongs to the visible thread, not the retained home composer', () => {
  const home = composer({ visible: false, portalVisible: true });
  const thread = composer({ threadId: 'current-thread' });
  assert.equal(select([home, thread]), thread.portal);
});
test('a retained thread ID in a hidden composer does not select that thread', () => {
  const old = composer({ visible: false, threadId: 'old-thread' });
  const current = composer({ threadId: 'current-thread' });
  assert.equal(select([old, current]), current.portal);
});
test('composer visibility changes select the new thread without requiring portal contents', () => {
  const first = composer({ threadId: 'first' });
  const second = composer({ visible: false, threadId: 'second' });
  assert.equal(select([first, second]), first.portal);
  first.setVisible(false);
  second.setVisible(true);
  assert.equal(select([first, second]), second.portal);
});
test('the home composer remains selectable and a fully hidden page has no active composer', () => {
  const home = composer();
  const old = composer({ visible: false, threadId: 'old-thread' });
  assert.equal(select([home, old]), home.portal);
  home.setVisible(false);
  assert.equal(select([home, old]), null);
});
