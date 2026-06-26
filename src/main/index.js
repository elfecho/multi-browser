const path = require('path');
const fs = require('fs-extra');
const { app, BrowserWindow, BrowserView, ipcMain, session, dialog } = require('electron');
const https = require('https');
const http = require('http');
const Database = require('./database');
const { AccountRepository, ProxyRepository, ExtensionRepository } = require('./repositories');
const BrowserManager = require('./browser-manager');
const { registerIpc, setMainWindow, setAccountRepository, setExtensionRepository, setBuiltinExtensionsDir, setSwitchToAccountViewFunc } = require('./ipc');

let mainWindow;
let browserManager;
let database;
let extensionRepository;
let isQuitting = false;
const loadedExtensions = new Set();

// 存储每个账号的 BrowserView
const accountBrowserViews = new Map();
const currentAccountIdRef = { current: null };
// 最近使用记录，用于 LRU 缓存
const recentUsage = [];
const MAX_CACHED_BROWSER_VIEWS = 5; // 最多保留 5 个

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 隐藏菜单栏
  mainWindow.setMenuBarVisibility(false);

  // 监听窗口大小变化
  mainWindow.on('resize', updateAllBrowserViewBounds);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

// 调整 BrowserView 位置大小
function getBrowserViewBounds() {
  const [width, height] = mainWindow.getContentSize();
  const sidebarWidth = 320;
  const controlsHeight = 60;
  return {
    x: sidebarWidth,
    y: controlsHeight,
    width: width - sidebarWidth,
    height: height - controlsHeight
  };
}

// 更新所有 BrowserView 的位置大小
function updateAllBrowserViewBounds() {
  const bounds = getBrowserViewBounds();
  accountBrowserViews.forEach((view) => {
    // 只更新当前可见的
    try {
      const viewBounds = view.getBounds();
      if (viewBounds.x !== 0) {
        view.setBounds(bounds);
      }
    } catch (e) {
      console.error('Error updating BrowserView bounds:', e);
    }
  });
}

// 处理文件下载（直接保存到 Downloads 目录）
async function handleFileDownload(url, defaultFilename = 'doubao_video.mp4') {
  try {
    // 获取 Downloads 目录
    const downloadsPath = app.getPath('downloads');
    
    // 处理文件名冲突
    let filename = defaultFilename;
    let filePath = path.join(downloadsPath, filename);
    let counter = 1;
    while (fs.existsSync(filePath)) {
      const ext = path.extname(filename);
      const name = path.basename(filename, ext);
      filePath = path.join(downloadsPath, `${name} (${counter})${ext}`);
      counter++;
    }

    console.log('[MultiBrowser] Downloading to:', filePath);

    // 下载文件
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          // 处理重定向
          handleFileDownload(response.headers.location, defaultFilename).then(resolve);
          return;
        }
        
        if (response.statusCode !== 200) {
          resolve({ success: false, error: '下载失败，状态码：' + response.statusCode });
          return;
        }
        
        const fileStream = fs.createWriteStream(filePath);
        response.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
          console.log('[MultiBrowser] Download complete:', filePath);
          resolve({ success: true, filePath });
        });
        
        fileStream.on('error', (err) => {
          fs.unlink(filePath, () => {}); // 删除出错的文件
          console.error('[MultiBrowser] Download error:', err);
          resolve({ success: false, error: err.message });
        });
        
      }).on('error', (err) => {
        console.error('[MultiBrowser] Download request error:', err);
        resolve({ success: false, error: err.message });
      });
    });
    
  } catch (error) {
    console.error('[MultiBrowser] handleFileDownload error:', error);
    return { success: false, error: error.message };
  }
}

// 设置会话级别的下载监听器（直接保存，不弹窗）
function setupDownloadHandler(session) {
  session.on('will-download', (event, item) => {
    // 直接保存到用户的下载文件夹
    const downloadsPath = app.getPath('downloads');
    const filename = item.getFilename();
    let filePath = path.join(downloadsPath, filename);
    
    // 处理文件名冲突
    let counter = 1;
    while (fs.existsSync(filePath)) {
      const ext = path.extname(filename);
      const name = path.basename(filename, ext);
      filePath = path.join(downloadsPath, `${name} (${counter})${ext}`);
      counter++;
    }
    
    item.setSavePath(filePath);

    item.once('done', (event, state) => {
      if (state === 'completed') {
        console.log('Download successfully to:', filePath);
      } else {
        console.log(`Download failed: ${state}`);
      }
    });
  });
}

// 更新使用记录
function updateUsage(accountId) {
  // 移除旧记录
  const index = recentUsage.indexOf(accountId);
  if (index !== -1) {
    recentUsage.splice(index, 1);
  }
  // 添加到开头
  recentUsage.unshift(accountId);
  // 清理超过限制的
  while (recentUsage.length > MAX_CACHED_BROWSER_VIEWS) {
    const removedId = recentUsage.pop();
    cleanupBrowserView(removedId);
  }
}

// 清理 BrowserView
function cleanupBrowserView(accountId) {
  if (accountId === currentAccountIdRef.current) {
    return; // 不清理当前活动的
  }
  if (accountBrowserViews.has(accountId)) {
    const view = accountBrowserViews.get(accountId);
    console.log(`Cleaning up BrowserView for account: ${accountId}`);
    mainWindow.removeBrowserView(view);
    accountBrowserViews.delete(accountId);
  }
}

// 创建或获取账号的 BrowserView
async function getOrCreateBrowserView(accountId, profilePath) {
  if (accountBrowserViews.has(accountId)) {
    updateUsage(accountId);
    return accountBrowserViews.get(accountId);
  }

  console.log(`Creating new BrowserView for account: ${accountId}`);
  
  // 创建新的 BrowserView，使用独立的 session
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      partition: `persist:${accountId}`, // 使用独立的分区，确保 cookie 等隔离
    }
  });

  view.setBounds(getBrowserViewBounds());
  accountBrowserViews.set(accountId, view);
  mainWindow.addBrowserView(view);
  
  // 为这个新的 BrowserView 加载所有启用的扩展
  await loadExtensionsForSession(view.webContents.session);
  
  updateUsage(accountId);

  return view;
}

// 切换到指定账号的 BrowserView
async function switchToAccountView(accountId, profilePath) {
  // 先隐藏当前的
  if (currentAccountIdRef.current && accountBrowserViews.has(currentAccountIdRef.current)) {
    const currentView = accountBrowserViews.get(currentAccountIdRef.current);
    currentView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }

  // 创建或获取目标账号的 BrowserView
  const view = await getOrCreateBrowserView(accountId, profilePath);
  const bounds = getBrowserViewBounds();
  view.setBounds(bounds);

  // 更新当前账号ID
  currentAccountIdRef.current = accountId;

  return view;
}

// 注册 BrowserView 相关的 IPC 处理
function registerBrowserViewIpc() {
  // 获取当前活动的 BrowserView
  function getCurrentBrowserView() {
    if (currentAccountIdRef.current && accountBrowserViews.has(currentAccountIdRef.current)) {
      return accountBrowserViews.get(currentAccountIdRef.current);
    }
    return null;
  }

  ipcMain.handle('browser-view:show', () => {
    const view = getCurrentBrowserView();
    if (view) {
      view.setBounds(getBrowserViewBounds());
    }
    return true;
  });

  ipcMain.handle('browser-view:hide', () => {
    const view = getCurrentBrowserView();
    if (view) {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    return true;
  });

  ipcMain.handle('browser-view:load-url', async (_, url) => {
    const view = getCurrentBrowserView();
    if (view) {
      await loadExtensions();
      
      // 检查是否是有效的 URL
      if (!url) {
        throw new Error('请输入有效的网址');
      }
      
      // 检查是否是 Chrome 内部页面
      if (url.startsWith('chrome://') || url.startsWith('edge://')) {
        throw new Error('无法访问浏览器内部页面，请使用 http:// 或 https:// 开头的网址');
      }
      
      // 自动添加 http 协议
      let validUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        validUrl = 'https://' + url;
      }
      
      try {
        await view.webContents.loadURL(validUrl);
        return true;
      } catch (error) {
        throw new Error(`无法加载网址: ${error.message}`);
      }
    }
    return false;
  });

  ipcMain.handle('browser-view:go-back', async () => {
    const view = getCurrentBrowserView();
    if (view && view.webContents.canGoBack()) {
      await view.webContents.goBack();
      return true;
    }
    return false;
  });

  ipcMain.handle('browser-view:go-forward', async () => {
    const view = getCurrentBrowserView();
    if (view && view.webContents.canGoForward()) {
      await view.webContents.goForward();
      return true;
    }
    return false;
  });

  ipcMain.handle('browser-view:reload', async () => {
    const view = getCurrentBrowserView();
    if (view) {
      await view.webContents.reload();
      return true;
    }
    return false;
  });

  ipcMain.handle('browser-view:get-url', async () => {
    const view = getCurrentBrowserView();
    if (view) {
      return view.webContents.getURL();
    }
    return '';
  });
  
  // 重新加载插件
  ipcMain.handle('browser-view:reload-extensions', async () => {
    await loadExtensions();
    return true;
  });

  // 切换账号并加载对应的 BrowserView
  ipcMain.handle('browser-view:switch-account', async (_, accountId, profilePath) => {
    const view = await switchToAccountView(accountId, profilePath);
    return { viewId: accountId };
  });

  // 删除账号时清理对应的 BrowserView
  ipcMain.handle('browser-view:remove-account', async (_, accountId) => {
    // 从最近使用记录中移除
    const index = recentUsage.indexOf(accountId);
    if (index !== -1) {
      recentUsage.splice(index, 1);
    }
    
    if (accountBrowserViews.has(accountId)) {
      const view = accountBrowserViews.get(accountId);
      mainWindow.removeBrowserView(view);
      accountBrowserViews.delete(accountId);
      // 如果删除的是当前账号，清空当前 ID
      if (currentAccountIdRef.current === accountId) {
        currentAccountIdRef.current = null;
      }
    }
    return true;
  });
}

// 为指定的 session 加载所有启用的插件
async function loadExtensionsForSession(session) {
  if (!extensionRepository) return;
  
  // 设置下载处理器
  setupDownloadHandler(session);
  
  const extensions = await extensionRepository.list();
  const enabledExtensions = extensions.filter(ext => ext.enabled);
  
  for (const ext of enabledExtensions) {
    try {
      await session.loadExtension(ext.path);
      console.log(`Loaded extension: ${ext.name}`);
    } catch (error) {
      console.error(`Failed to load extension ${ext.name}:`, error);
    }
  }
}

// 加载所有启用的插件（为当前活动的 session）
async function loadExtensions() {
  if (currentAccountIdRef.current && accountBrowserViews.has(currentAccountIdRef.current)) {
    const view = accountBrowserViews.get(currentAccountIdRef.current);
    await loadExtensionsForSession(view.webContents.session);
  }
}

// 自动添加内置插件
async function autoAddBuiltinExtensions() {
  const builtinDir = path.join(__dirname, '../../builtin-extensions');
  
  if (!await fs.pathExists(builtinDir)) {
    return;
  }
  
  const files = await fs.readdir(builtinDir);
  
  for (const file of files) {
    const fullPath = path.join(builtinDir, file);
    const stat = await fs.stat(fullPath);
    
    if (stat.isDirectory()) {
      const manifestPath = path.join(fullPath, 'manifest.json');
      if (await fs.pathExists(manifestPath)) {
        try {
          const manifest = await fs.readJson(manifestPath);
          const name = manifest.name || file;
          
          // 检查是否已经添加了
          const existingExts = await extensionRepository.list();
          const alreadyExists = existingExts.some(ext => ext.path === fullPath);
          
          if (!alreadyExists) {
            // 自动添加并启用
            await extensionRepository.create({
              name,
              path: fullPath,
              enabled: true
            });
            console.log(`Auto-added builtin extension: ${name}`);
          }
        } catch (error) {
          console.error(`Failed to process builtin extension ${file}:`, error);
        }
      }
    }
  }
}

async function bootstrap() {
  database = new Database();
  await database.init();

  const accountRepository = new AccountRepository(database);
  const proxyRepository = new ProxyRepository(database);
  extensionRepository = new ExtensionRepository(database);
  browserManager = new BrowserManager(accountRepository, proxyRepository);

  registerIpc({
    accountRepository,
    proxyRepository,
    browserManager
  });
  
  // 设置仓库和目录
  setAccountRepository(accountRepository);
  setExtensionRepository(extensionRepository);
  setBuiltinExtensionsDir(path.join(__dirname, '../../builtin-extensions'));
  setSwitchToAccountViewFunc(switchToAccountView);
  
  // 自动添加内置插件
  await autoAddBuiltinExtensions();
  
  // 检查是否有账号，没有就自动创建账号 1
  const existingAccounts = await accountRepository.list();
  if (existingAccounts.length === 0) {
    await accountRepository.create({ name: '账号 1' });
    console.log('Auto created default account: 账号 1');
  }
  
  // 注册 BrowserView 相关 IPC
  registerBrowserViewIpc();

  await createWindow();
  setMainWindow(mainWindow);
  
  // 传递必要的引用给 ipc 模块
  global.accountBrowserViews = accountBrowserViews;
  global.currentAccountIdRef = currentAccountIdRef;
  global.loadExtensionsFunc = loadExtensionsForSession;
  global.handleFileDownload = handleFileDownload;
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
  if (isQuitting) return;
  if (!browserManager) return;
  event.preventDefault();
  isQuitting = true;
  await browserManager.closeAll();
  if (database) await database.close();
  browserManager = null;
  database = null;
  app.quit();
});
