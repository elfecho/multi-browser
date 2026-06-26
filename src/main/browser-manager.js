const { chromium } = require('playwright');

class BrowserManager {
  constructor(accountRepository, proxyRepository) {
    this.accountRepository = accountRepository;
    this.proxyRepository = proxyRepository;
    this.sessions = new Map();
  }

  listRunning() {
    return Array.from(this.sessions.keys());
  }

  isRunning(accountId) {
    return this.sessions.has(accountId);
  }

  async launch(accountId) {
    if (this.sessions.has(accountId)) {
      return { accountId, status: 'running' };
    }

    const account = await this.accountRepository.get(accountId);
    if (!account) throw new Error('Account not found');

    const launchOptions = this.createLaunchOptions(account);
    if (account.proxy_id) {
      const proxy = await this.proxyRepository.get(account.proxy_id, true);
      if (proxy && proxy.enabled) {
        launchOptions.proxy = this.toPlaywrightProxy(proxy);
      }
    }

    const context = await chromium.launchPersistentContext(account.profile_path, launchOptions);
    context.on('close', () => {
      this.sessions.delete(accountId);
    });

    this.sessions.set(accountId, context);
    await this.accountRepository.markOpened(accountId);

    const pages = context.pages();
    let page;
    if (pages.length === 0) {
      page = await context.newPage();
    } else {
      page = pages[0];
    }
    
    const homepage = account.environment.homepage || 'https://www.dola.com/chat/create-image';
    await page.goto(homepage);

    return { accountId, status: 'running' };
  }

  async close(accountId) {
    const context = this.sessions.get(accountId);
    if (!context) return { accountId, status: 'stopped' };

    await context.close();
    this.sessions.delete(accountId);
    return { accountId, status: 'stopped' };
  }

  async closeAll() {
    const closes = Array.from(this.sessions.keys()).map((accountId) => this.close(accountId));
    await Promise.allSettled(closes);
  }

  createLaunchOptions(account) {
    const env = account.environment;
    return {
      headless: false,
      userAgent: env.userAgent,
      locale: env.locale,
      timezoneId: env.timezoneId,
      viewport: env.viewport,
      colorScheme: env.colorScheme || 'light',
      args: [
        `--window-size=${env.viewport.width},${env.viewport.height}`,
        '--disable-blink-features=AutomationControlled'
      ]
    };
  }

  toPlaywrightProxy(proxy) {
    const server = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
    const result = { server };
    if (proxy.username) result.username = proxy.username;
    if (proxy.password) result.password = proxy.password;
    return result;
  }
}

module.exports = BrowserManager;
