import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileFunction } from 'node:vm';
import { parse } from 'acorn';

const source = await readFile(new URL('../src/native/controls.js', import.meta.url), 'utf8');
const factory = parse(source, { ecmaVersion: 'latest' }).body[0].expression.callee;
const parser = factory.body.body.find(
  (node) => node.type === 'FunctionDeclaration' && node.id.name === 'parseCommand',
);
const command = compileFunction(`return (${source.slice(parser.start, parser.end)})(text);`, [
  'text',
]);

test('local commands accept only the documented command and explicit visibility actions', () => {
  for (const text of ['/cot', ' /CoT ', '/cot toggle']) assert.equal(command(text), 'toggle');
  for (const text of ['/cot on', '/cot show', '/COT\tON']) assert.equal(command(text), 'show');
  for (const text of ['/cot off', '/cot hide']) assert.equal(command(text), 'hide');
});
test('unrelated slash commands and multi-line prose remain ordinary composer input', () => {
  for (const text of [
    '/review',
    '/cotton',
    'explain /cot',
    '/cot on\nthen explain',
    '/cot\n',
    '\n/cot',
    '/cot /review',
  ]) {
    assert.equal(command(text), text === '/cot /review' ? 'invalid' : null);
  }
});
test('invalid arguments to the reserved local command never become a model prompt', () => {
  for (const text of ['/cot invalid', '/cot on please']) assert.equal(command(text), 'invalid');
});

test('menu command spellings have the same local visibility semantics', () => {
  assert.equal(command('/cot-on'), 'show');
  assert.equal(command('/COT-OFF'), 'hide');
  assert.equal(command('/cot-on extra'), 'invalid');
  assert.equal(command('/cot-off\n'), null);
  assert.equal(command('/cot-only'), null);
});
