const { contextBridge, ipcRenderer } = require('electron');

const api = {
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    create: (input) => ipcRenderer.invoke('accounts:create', input),
    delete: (id) => ipcRenderer.invoke('accounts:delete', id)
  },
  browser: {
    launch: (accountId) => ipcRenderer.invoke('browser:launch', accountId),
    activate: (accountId) => ipcRenderer.invoke('browser:activate', accountId),
    close: (accountId) => ipcRenderer.invoke('browser:close', accountId),
    isRunning: (accountId) => ipcRenderer.invoke('browser:is-running', accountId),
    selectImageFile: (file) => ipcRenderer.invoke('browser:select-image-file', file),
    sendPrompt: (accountId, prompt, imagePath) => ipcRenderer.invoke('browser:send-prompt', accountId, prompt, imagePath)
  },
  downloads: {
    get: (accountId) => ipcRenderer.invoke('downloads:get', accountId),
    openDir: () => ipcRenderer.invoke('downloads:open-dir')
  },
  downloadHistory: {
    getByAccount: (accountId) => ipcRenderer.invoke('download-history:get-by-account', accountId)
  },
  showCreateAccountDialog: () => ipcRenderer.invoke('show-create-account-dialog'),
  onDownloadEvent: (callback) => ipcRenderer.on('download-event', (_event, data) => callback(data))
};

contextBridge.exposeInMainWorld('multiBrowser', api);
