const test = require('node:test');
const assert = require('node:assert/strict');
const { generateEnvironment } = require('../src/main/environment');

test('generateEnvironment is stable for the same seed', () => {
  const first = generateEnvironment('account-a');
  const second = generateEnvironment('account-a');

  assert.deepEqual(first, second);
});

test('generateEnvironment returns required Playwright environment fields', () => {
  const environment = generateEnvironment('account-b');

  assert.equal(typeof environment.userAgent, 'string');
  assert.equal(typeof environment.locale, 'string');
  assert.equal(typeof environment.timezoneId, 'string');
  assert.equal(typeof environment.viewport.width, 'number');
  assert.equal(typeof environment.viewport.height, 'number');
});
