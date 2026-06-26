const { chromium } = require('playwright');

async function testProxy(proxy) {
  const start = Date.now();
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      proxy: toPlaywrightProxy(proxy)
    });
    const page = await browser.newPage();
    const response = await page.goto('https://example.com', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    return {
      ok: Boolean(response && response.ok()),
      status: response ? response.status() : 0,
      durationMs: Date.now() - start
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - start,
      error: error.message
    };
  } finally {
    if (browser) await browser.close();
  }
}

function toPlaywrightProxy(proxy) {
  const result = {
    server: `${proxy.protocol}://${proxy.host}:${proxy.port}`
  };
  if (proxy.username) result.username = proxy.username;
  if (proxy.password) result.password = proxy.password;
  return result;
}

module.exports = {
  testProxy
};
