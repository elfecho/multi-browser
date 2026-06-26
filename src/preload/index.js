const { contextBridge, ipcRenderer } = require('electron');

const api = {
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    create: (input) => ipcRenderer.invoke('accounts:create', input),
    delete: (id) => ipcRenderer.invoke('accounts:delete', id)
  },
  browser: {
    launch: (accountId) => ipcRenderer.invoke('browser:launch', accountId)
  },
  browserView: {
    show: () => ipcRenderer.invoke('browser-view:show'),
    hide: () => ipcRenderer.invoke('browser-view:hide'),
    loadUrl: (url) => ipcRenderer.invoke('browser-view:load-url', url),
    goBack: () => ipcRenderer.invoke('browser-view:go-back'),
    goForward: () => ipcRenderer.invoke('browser-view:go-forward'),
    reload: () => ipcRenderer.invoke('browser-view:reload'),
    getUrl: () => ipcRenderer.invoke('browser-view:get-url')
  },
  showCreateAccountDialog: () => ipcRenderer.invoke('show-create-account-dialog'),
  handleDownload: (url, filename) => ipcRenderer.invoke('handle-file-download', url, filename)
};

contextBridge.exposeInMainWorld('multiBrowser', api);
