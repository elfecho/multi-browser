const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs-extra');
const path = require('path');
let accountRepo;
let extensionRepo;
let builtinExtensionsDir;
let doubaoScript = '';
let switchToAccountViewFunc = null;
let mainWindow = null;

function setMainWindow(win) {
  mainWindow = win;
}

function setAccountRepository(repo) {
  accountRepo = repo;
}

function setExtensionRepository(repo) {
  extensionRepo = repo;
}

function setBuiltinExtensionsDir(dir) {
  builtinExtensionsDir = dir;
}

function setSwitchToAccountViewFunc(func) {
  switchToAccountViewFunc = func;
}

async function initDoubaoScript() {
  try {
    const doubaoScriptPath = path.join(__dirname, '../../builtin-extensions/doubao-downloader.user.js');
    if (await fs.pathExists(doubaoScriptPath)) {
      doubaoScript = await fs.readFile(doubaoScriptPath, 'utf-8');
      console.log('Loaded doubao script');
    }
  } catch (error) {
    console.error('Failed to load doubao script:', error);
  }
}

function getCurrentBrowserView() {
  if (global.currentAccountIdRef && global.currentAccountIdRef.current && global.accountBrowserViews) {
    return global.accountBrowserViews.get(global.currentAccountIdRef.current);
  }
  return null;
}

function assertName(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

// 创建账号弹窗（简化版）
async function showCreateAccountDialog() {
  // 获取现有账号，找到下一个可用的数字
  let nextNumber = 1;
  if (accountRepo) {
    const accounts = await accountRepo.list();
    const numbers = accounts
      .map(acc => {
        const match = acc.name.match(/^账号\s*(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => n > 0);
    
    if (numbers.length > 0) {
      nextNumber = Math.max(...numbers) + 1;
    }
  }
  
  const defaultName = `账号 ${nextNumber}`;
  
  // 使用更简单的自定义窗口
  return new Promise((resolve) => {
    const modalWindow = new BrowserWindow({
      width: 360,
      height: 180,
      parent: mainWindow,
      modal: true,
      show: false,
      resizable: false,
      frame: true,
      title: '新建账号',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    modalWindow.setMenuBarVisibility(false);

    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      if (!modalWindow.isDestroyed()) modalWindow.destroy();
      resolve(result);
    };

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { 
      font-family: system-ui; 
      padding: 20px; 
      margin: 0;
    }
    input { 
      width: 100%; 
      padding: 8px 12px; 
      box-sizing: border-box; 
      margin-bottom: 16px;
      border:1px solid #ddd; 
      border-radius:4px;
    }
    .btns { 
      display:flex; 
      justify-content:flex-end; 
      gap:12px; 
    }
    button { 
      padding:6px 16px; 
      border-radius:4px; 
      cursor:pointer; 
    }
  </style>
</head>
<body>
  <input id="name" value="${defaultName}" placeholder="账号名称">
  <div class="btns">
    <button onclick="done(false)">取消</button>
    <button onclick="done(true)" style="background:#1677ff; color:white; border:none;">保存</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    function done(save) {
      if (save) {
        ipcRenderer.send('res', { name: document.getElementById('name').value.trim() });
      } else {
        ipcRenderer.send('res', null);
      }
    }
    document.getElementById('name').focus();
    document.getElementById('name').select();
  </script>
</body>
</html>`;

    modalWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    modalWindow.once('ready-to-show', () => modalWindow.show());
    ipcMain.once('res', (_, r) => finish(r));
    modalWindow.on('closed', () => finish(null));
  });
}

function registerIpc({ accountRepository, proxyRepository, browserManager }) {
  accountRepo = accountRepository;
  initDoubaoScript();

  ipcMain.handle('accounts:list', async () => accountRepository.list());

  ipcMain.handle('accounts:create', async (_event, input) => {
    return accountRepository.create({
      ...input,
      name: assertName(input && input.name, 'Account name')
    });
  });

  ipcMain.handle('accounts:delete', async (_event, id) => {
    if (global.accountBrowserViews && global.accountBrowserViews.has(id)) {
      const view = global.accountBrowserViews.get(id);
      if (mainWindow) {
        mainWindow.removeBrowserView(view);
      }
      global.accountBrowserViews.delete(id);
      if (global.currentAccountIdRef && global.currentAccountIdRef.current === id) {
        global.currentAccountIdRef.current = null;
      }
    }
    return accountRepository.delete(id);
  });

  // 新增账号弹窗
  ipcMain.handle('show-create-account-dialog', showCreateAccountDialog);
  
  // 处理下载
  ipcMain.handle('handle-file-download', async (_event, url, filename) => {
    if (global.handleFileDownload) {
      return await global.handleFileDownload(url, filename);
    }
    return { success: false, error: 'Download handler not available' };
  });

  // 简化的 browser launch
  ipcMain.handle('browser:launch', async (_event, accountId) => {
    const account = await accountRepository.get(accountId);
    if (!account) throw new Error('Account not found');

    if (switchToAccountViewFunc) {
      await switchToAccountViewFunc(accountId, account.profile_path);
    } else if (global.accountBrowserViews && global.currentAccountIdRef) {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('Main window not found');

      if (global.currentAccountIdRef.current && global.accountBrowserViews.has(global.currentAccountIdRef.current)) {
        const currentView = global.accountBrowserViews.get(global.currentAccountIdRef.current);
        currentView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }

      let view;
      if (global.accountBrowserViews.has(accountId)) {
        view = global.accountBrowserViews.get(accountId);
      } else {
        const { BrowserView } = require('electron');
        view = new BrowserView({
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            partition: `persist:${accountId}`
          }
        });
        const [width, height] = win.getContentSize();
        const sidebarWidth = 320;
        const controlsHeight = 60;
        view.setBounds({ x: sidebarWidth, y: controlsHeight, width: width - sidebarWidth, height: height - controlsHeight });
        win.addBrowserView(view);
        global.accountBrowserViews.set(accountId, view);
        
        if (global.loadExtensionsFunc) {
          try {
            await global.loadExtensionsFunc(view.webContents.session);
          } catch (e) {
            console.error('Failed to load extensions:', e);
          }
        }
      }

      const [width, height] = win.getContentSize();
      const sidebarWidth = 320;
      const controlsHeight = 60;
      view.setBounds({ x: sidebarWidth, y: controlsHeight, width: width - sidebarWidth, height: height - controlsHeight });
      global.currentAccountIdRef.current = accountId;
    }

    const view = getCurrentBrowserView();
    if (!view) throw new Error('Browser view not found');

    let hasUrl = view.webContents.getURL();
    if (!hasUrl || hasUrl === 'about:blank') {
      let urlToLoad = account.last_url || account.environment.homepage || 'https://www.dola.com/chat/create-image';
      if (!urlToLoad.startsWith('http://') && !urlToLoad.startsWith('https://')) {
        urlToLoad = 'https://' + urlToLoad;
      }
      try {
        await view.webContents.loadURL(urlToLoad);
      } catch (error) {
        console.error('Failed to load URL:', error);
      }
    }

    const webContents = view.webContents;
    if (!webContents.__listenersInitialized) {
      webContents.__listenersInitialized = true;
      
      // 插件会完整运行，我们在主进程里用 will-download 来处理下载

      if (doubaoScript) {
        webContents.on('did-finish-load', async () => {
          try {
            const url = webContents.getURL();
            if (url.includes('doubao.com') || url.includes('dola.com')) {
              console.log('Injecting doubao script:', url);
              await webContents.executeJavaScript(doubaoScript);
              console.log('Doubao script injected');
            }
          } catch (error) {
            console.error('Failed to inject doubao script:', error);
          }
        });
      }

      webContents.on('did-navigate', async (_event, url) => {
        if (global.currentAccountIdRef && global.currentAccountIdRef.current === accountId && url && url.startsWith('http')) {
          try {
            await accountRepository.saveLastUrl(accountId, url);
          } catch (error) {
            console.error('Failed to save last URL:', error);
          }
        }
      });
    }

    await accountRepository.markOpened(accountId);
    return { accountId, status: 'running' };
  });
}

module.exports = {
  registerIpc,
  setMainWindow,
  setAccountRepository,
  setExtensionRepository,
  setBuiltinExtensionsDir,
  setSwitchToAccountViewFunc
};
