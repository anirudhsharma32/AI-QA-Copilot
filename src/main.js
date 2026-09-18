const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { Worker } = require('worker_threads');

let mainWindow;
let githubToken = '';

function githubRequest(token, endpoint) {
  return new Promise((resolve, reject) => {
    const request = require('https').request({
      hostname: 'api.github.com',
      path: endpoint,
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'AI-QA-Copilot'
      }
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        let data;
        try { data = JSON.parse(body); } catch { data = {}; }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(data.message || 'GitHub authentication failed.'));
          return;
        }
        resolve(data);
      });
    });
    request.on('error', (error) => reject(new Error(`GitHub connection failed: ${error.message}`)));
    request.end();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f5f7f8',
    title: 'AI QA Copilot',
    icon: nativeImage.createEmpty(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{
      name: 'QA source files',
      extensions: ['txt', 'csv', 'json', 'log', 'py', 'js', 'jsx', 'ts', 'java', 'sql', 'md', 'doc', 'docx', 'pdf']
    }, { name: 'All files', extensions: ['*'] }]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const stats = await fs.stat(filePath);
  if (stats.size > 2 * 1024 * 1024) {
    throw new Error('Please choose a file smaller than 2 MB.');
  }
  const content = await fs.readFile(filePath, 'utf8');
  return { name: path.basename(filePath), content };
});

ipcMain.handle('save-response', async (_event, response) => {
  if (!response || !response.trim()) throw new Error('There is no response to save yet.');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save QA analysis',
    defaultPath: 'qa-analysis.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }]
  });
  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, response, 'utf8');
  return true;
});

ipcMain.handle('analyze', async (_event, payload) => new Promise((resolve, reject) => {
  if (!payload?.apiKey?.trim()) return reject(new Error('Enter your OpenAI API key to continue.'));
  if (!payload?.input?.trim()) return reject(new Error('Add a QA brief, requirement, defect, or test artifact first.'));

  const worker = new Worker(path.join(__dirname, 'qa-worker.js'), { workerData: payload });
  worker.once('message', (message) => {
    if (message.ok) resolve(message.response);
    else reject(new Error(message.error));
  });
  worker.once('error', (error) => reject(new Error(`Worker error: ${error.message}`)));
  worker.once('exit', (code) => {
    if (code !== 0) reject(new Error(`Analysis worker stopped unexpectedly (${code}).`));
  });
}));

ipcMain.handle('github-connect', async (_event, token) => {
  if (!token?.trim()) throw new Error('Enter a GitHub fine-grained token to continue.');
  const account = await githubRequest(token.trim(), '/user');
  githubToken = token.trim();
  return { login: account.login, name: account.name || account.login };
});

ipcMain.handle('github-status', () => ({ connected: Boolean(githubToken) }));
ipcMain.handle('github-disconnect', () => { githubToken = ''; return true; });

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('will-quit', () => { githubToken = ''; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
