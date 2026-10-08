const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qaCopilot', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  analyze: (payload) => ipcRenderer.invoke('analyze', payload),
  saveResponse: (response) => ipcRenderer.invoke('save-response', response),
  connectGithub: (token) => ipcRenderer.invoke('github-connect', token),
  githubStatus: () => ipcRenderer.invoke('github-status'),
  disconnectGithub: () => ipcRenderer.invoke('github-disconnect'),
  connectTestRail: (credentials) => ipcRenderer.invoke('testrail-connect', credentials),
  getTestRailProjectData: (projectId) => ipcRenderer.invoke('testrail-project-data', projectId),
  disconnectTestRail: () => ipcRenderer.invoke('testrail-disconnect'),
  connectAtlassian: (credentials) => ipcRenderer.invoke('atlassian-connect', credentials),
  getAtlassianProjectData: (selection) => ipcRenderer.invoke('atlassian-project-data', selection),
  createJiraBug: (request) => ipcRenderer.invoke('jira-create-bug', request),
  createJiraRequest: (request) => ipcRenderer.invoke('jira-create-request', request),
  disconnectAtlassian: () => ipcRenderer.invoke('atlassian-disconnect')
});
