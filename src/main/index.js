const path = require('path');
const { app, BrowserWindow } = require('electron');
const Database = require('./database');
const { AccountRepository, DownloadHistoryRepository } = require('./repositories');
const BrowserManager = require('./browser-manager');
const { registerIpc, setMainWindow, setAccountRepository, setBrowserManager } = require('./ipc');

let mainWindow;
let database;
let browserManager;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

async function bootstrap() {
  database = new Database();
  await database.init();

  const accountRepository = new AccountRepository(database);
  const downloadHistoryRepository = new DownloadHistoryRepository(database);
  browserManager = new BrowserManager(accountRepository, downloadHistoryRepository);

  registerIpc({ accountRepository, browserManager, downloadHistoryRepository });
  setAccountRepository(accountRepository);
  setBrowserManager(browserManager);
  setMainWindow(mainWindow);

  // 检查是否有账号，没有就自动创建账号 1
  const existingAccounts = await accountRepository.list();
  if (existingAccounts.length === 0) {
    await accountRepository.create({ name: '账号 1' });
    console.log('Auto created default account: 账号 1');
  }

  await createWindow();
  setMainWindow(mainWindow);
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async (event) => {
  if (browserManager) await browserManager.closeAll();
  if (database) await database.close();
  browserManager = null;
  database = null;
});
