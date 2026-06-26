const { ipcMain, BrowserWindow } = require('electron');
let accountRepo;
let browserMgr;
let downloadHistoryRepo;
let mainWindow = null;

function setMainWindow(win) {
  mainWindow = win;
}

function setAccountRepository(repo) {
  accountRepo = repo;
}

function setBrowserManager(mgr) {
  browserMgr = mgr;
  // 覆盖 emitDownloadEvent 方法，以便发送 IPC 事件
  if (browserMgr) {
    const originalEmit = browserMgr.emitDownloadEvent.bind(browserMgr);
    browserMgr.emitDownloadEvent = function(accountId, event) {
      originalEmit(accountId, event);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-event', { accountId, ...event });
      }
    };
  }
}

function assertName(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

// 创建账号弹窗
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

function registerIpc({ accountRepository, browserManager, downloadHistoryRepository }) {
  accountRepo = accountRepository;
  browserMgr = browserManager;
  downloadHistoryRepo = downloadHistoryRepository;

  ipcMain.handle('accounts:list', async () => accountRepository.list());

  ipcMain.handle('accounts:create', async (_event, input) => {
    return accountRepository.create({
      ...input,
      name: assertName(input && input.name, 'Account name')
    });
  });

  ipcMain.handle('accounts:delete', async (_event, id) => {
    return accountRepository.delete(id);
  });

  // 新增账号弹窗
  ipcMain.handle('show-create-account-dialog', showCreateAccountDialog);
  
  // 启动隔离浏览器
  ipcMain.handle('browser:launch', async (_event, accountId) => {
    return await browserMgr.launch(accountId);
  });

  // 关闭浏览器
  ipcMain.handle('browser:close', async (_event, accountId) => {
    return await browserMgr.close(accountId);
  });

  // 检查浏览器是否运行
  ipcMain.handle('browser:is-running', async (_event, accountId) => {
    return { running: browserMgr.isRunning(accountId) };
  });

  // 选择并保存图片文件
  ipcMain.handle('browser:select-image-file', async (_event, file) => {
    return await browserMgr.saveImageFile(file);
  });

  // 发送提示词到浏览器
  ipcMain.handle('browser:send-prompt', async (_event, accountId, prompt, imagePath) => {
    return await browserMgr.sendPrompt(accountId, prompt, imagePath);
  });

  // 获取账号的下载记录
  ipcMain.handle('downloads:get', async (_event, accountId) => {
    return browserMgr.getDownloads(accountId);
  });

  // 打开下载目录
  ipcMain.handle('downloads:open-dir', async () => {
    const { shell } = require('electron');
    await shell.openPath(browserMgr.downloadDir);
    return { success: true };
  });
  
  // 获取账号的下载历史
  ipcMain.handle('download-history:get-by-account', async (_event, accountId) => {
    return downloadHistoryRepo.getByAccount(accountId);
  });
  
  // 激活浏览器窗口（如果已启动）
  ipcMain.handle('browser:activate', async (_event, accountId) => {
    return await browserMgr.activate(accountId);
  });
}

module.exports = {
  registerIpc,
  setMainWindow,
  setAccountRepository,
  setBrowserManager
};
