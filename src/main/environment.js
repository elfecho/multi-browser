const crypto = require('crypto');

const presets = [
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1366, height: 768 }
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1440, height: 900 }
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'Europe/London',
    viewport: { width: 1680, height: 1050 }
  }
];

function generateEnvironment(seed) {
  const hash = crypto.createHash('sha256').update(seed).digest();
  const preset = presets[hash[0] % presets.length];

  return {
    ...preset,
    colorScheme: 'light',
    homepage: 'https://www.dola.com/chat/create-image'
  };
}

module.exports = {
  generateEnvironment
};
