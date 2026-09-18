const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qaCopilot', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  analyze: (payload) => ipcRenderer.invoke('analyze', payload),
  saveResponse: (response) => ipcRenderer.invoke('save-response', response),
  connectGithub: (token) => ipcRenderer.invoke('github-connect', token),
  githubStatus: () => ipcRenderer.invoke('github-status'),
  disconnectGithub: () => ipcRenderer.invoke('github-disconnect')
});
