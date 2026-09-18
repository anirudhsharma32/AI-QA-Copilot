const apiKeyInput = document.querySelector('#api-key');
const modelInput = document.querySelector('#model');
const qaInput = document.querySelector('#qa-input');
const charCount = document.querySelector('#char-count');
const fileName = document.querySelector('#file-name');
const responseArea = document.querySelector('#response-area');
const statusLine = document.querySelector('#status-line');
const statusText = document.querySelector('#status-text');
const generateButton = document.querySelector('#generate-button');
const githubTokenInput = document.querySelector('#github-token');
const githubButton = document.querySelector('#github-button');
const githubStatus = document.querySelector('#github-status');
const githubDot = document.querySelector('#github-dot');
let selectedFileName = '';
let lastResponse = '';

function setStatus(message, type = '') {
  statusText.textContent = message;
  statusLine.className = `status-line ${type}`.trim();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  let html = '';
  let inList = false;
  let inTable = false;
  lines.forEach((line) => {
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^[-: ]+$/.test(cell))) return;
      if (!inTable) { html += '<table>'; inTable = true; }
      const tag = html.endsWith('<table>') ? 'th' : 'td';
      html += `<tr>${cells.map((cell) => `<${tag}>${inlineMarkdown(cell)}</${tag}>`).join('')}</tr>`;
      return;
    }
    if (inTable) { html += '</table>'; inTable = false; }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineMarkdown(line.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.startsWith('## ')) html += `<h2>${inlineMarkdown(line.slice(3))}</h2>`;
      else if (line.trim()) html += `<p>${inlineMarkdown(line)}</p>`;
    }
  });
  if (inList) html += '</ul>'; if (inTable) html += '</table>';
  return html;
}
function inlineMarkdown(value) { return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>'); }

qaInput.addEventListener('input', () => { charCount.textContent = `${qaInput.value.length.toLocaleString()} / 30,000`; });

githubButton.addEventListener('click', async () => {
  if (githubButton.dataset.connected === 'true') {
    await window.qaCopilot.disconnectGithub();
    githubButton.dataset.connected = 'false';
    githubButton.textContent = 'Connect GitHub';
    githubStatus.textContent = 'GitHub not connected';
    githubDot.classList.remove('connected');
    setStatus('GitHub disconnected', 'success');
    return;
  }
  try {
    const account = await window.qaCopilot.connectGithub(githubTokenInput.value);
    githubButton.dataset.connected = 'true';
    githubButton.textContent = 'Disconnect';
    githubStatus.textContent = `GitHub: ${account.login}`;
    githubDot.classList.add('connected');
    githubTokenInput.value = '';
    setStatus(`Connected to GitHub as ${account.login}`, 'success');
  } catch (error) { setStatus(error.message, 'error'); }
});

document.querySelector('#upload-button').addEventListener('click', async () => {
  try {
    const file = await window.qaCopilot.selectFile();
    if (!file) return;
    selectedFileName = file.name;
    qaInput.value = file.content;
    charCount.textContent = `${qaInput.value.length.toLocaleString()} / 30,000`;
    fileName.textContent = file.name;
    setStatus(`${file.name} attached and ready`, 'success');
  } catch (error) { setStatus(error.message, 'error'); }
});

generateButton.addEventListener('click', async () => {
  if (!apiKeyInput.value.trim() || !qaInput.value.trim()) {
    setStatus(!apiKeyInput.value.trim() ? 'An API key is required' : 'Add QA material before generating', 'error');
    return;
  }
  generateButton.disabled = true;
  generateButton.querySelector('span').textContent = 'Analyzing...';
  setStatus('QA Copilot is examining risk and coverage', 'busy');
  responseArea.innerHTML = '<div class="empty-state"><div class="empty-glyph">...</div><h3>Building your test map.</h3><p>The analysis is running in a background worker. You can keep preparing the brief.</p></div>';
  try {
    lastResponse = await window.qaCopilot.analyze({ apiKey: apiKeyInput.value, model: modelInput.value, input: qaInput.value, fileName: selectedFileName });
    responseArea.innerHTML = `<div class="response-content">${markdownToHtml(lastResponse)}</div>`;
    setStatus('Analysis complete · ready to review', 'success');
  } catch (error) {
    responseArea.innerHTML = `<div class="empty-state"><div class="empty-glyph">!</div><h3>Analysis could not run.</h3><p>${escapeHtml(error.message)}</p></div>`;
    setStatus(error.message, 'error');
  } finally { generateButton.disabled = false; generateButton.querySelector('span').textContent = 'Generate QA analysis'; }
});

document.querySelector('#clear-button').addEventListener('click', () => { qaInput.value = ''; selectedFileName = ''; lastResponse = ''; fileName.textContent = 'TXT, CSV, JSON, LOG, PY, JS, JAVA, SQL, DOCS'; charCount.textContent = '0 / 30,000'; responseArea.innerHTML = '<div class="empty-state"><div class="empty-glyph">+</div><h3>Your analysis will land here.</h3><p>Copilot will structure risk, acceptance criteria, scenarios, and the next action into a review-ready brief.</p></div>'; setStatus('Waiting for your QA material'); });
document.querySelector('#copy-button').addEventListener('click', async () => { if (!lastResponse) return setStatus('Generate a response before copying', 'error'); await navigator.clipboard.writeText(lastResponse); setStatus('Response copied to clipboard', 'success'); });
document.querySelector('#save-button').addEventListener('click', async () => { if (!lastResponse) return setStatus('Generate a response before saving', 'error'); try { const saved = await window.qaCopilot.saveResponse(lastResponse); if (saved) setStatus('Response saved successfully', 'success'); } catch (error) { setStatus(error.message, 'error'); } });
document.querySelector('#regenerate-button').addEventListener('click', () => { if (lastResponse) generateButton.click(); else setStatus('Generate an analysis before regenerating', 'error'); });
