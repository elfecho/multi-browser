const test = require('node:test');
const assert = require('node:assert/strict');
const BrowserManager = require('../src/main/browser-manager');

test('toPlaywrightProxy maps proxy credentials when present', () => {
  const manager = new BrowserManager({}, {});

  const proxy = manager.toPlaywrightProxy({
    protocol: 'socks5',
    host: '127.0.0.1',
    port: 1080,
    username: 'user',
    password: 'secret'
  });

  assert.deepEqual(proxy, {
    server: 'socks5://127.0.0.1:1080',
    username: 'user',
    password: 'secret'
  });
});

test('createLaunchOptions uses account environment', () => {
  const manager = new BrowserManager({}, {});
  const options = manager.createLaunchOptions({
    environment: {
      userAgent: 'ua',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1280, height: 800 },
      colorScheme: 'light'
    }
  });

  assert.equal(options.headless, false);
  assert.equal(options.userAgent, 'ua');
  assert.equal(options.locale, 'zh-CN');
  assert.equal(options.timezoneId, 'Asia/Shanghai');
  assert.deepEqual(options.viewport, { width: 1280, height: 800 });
  assert.ok(options.args.includes('--window-size=1280,800'));
});
