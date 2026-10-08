const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { Worker } = require('worker_threads');
const https = require('https');

let mainWindow;
let githubToken = '';
let testRailCredentials = null;
let atlassianCredentials = null;

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

function testRailRequest(credentials, endpoint) {
  return new Promise((resolve, reject) => {
    const instanceUrl = new URL(credentials.instanceUrl);
    const basePath = instanceUrl.pathname.replace(/\/+$/, '').replace(/\/index\.php$/, '');
    const request = https.request({
      hostname: instanceUrl.hostname,
      port: instanceUrl.port || 443,
      path: `${basePath}/index.php?/api/v2/${endpoint}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64')}`,
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
          const message = response.statusCode === 401
            ? 'TestRail rejected the account email or API key.'
            : data.error || data.message || `TestRail request failed (${response.statusCode}).`;
          reject(new Error(message));
          return;
        }
        resolve(data);
      });
    });
    request.setTimeout(15000, () => request.destroy(new Error('TestRail request timed out.')));
    request.on('error', (error) => reject(new Error(`TestRail connection failed: ${error.message}`)));
    request.end();
  });
}

function atlassianRequest(credentials, endpoint, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(endpoint, credentials.siteUrl);
    const request = https.request(requestUrl, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Basic ${Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64')}`,
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
          const message = response.statusCode === 401
            ? 'Atlassian rejected the account email or API token.'
            : data.message || data.errorMessages?.join(' ') || Object.values(data.errors || {}).join(' ') || `Atlassian request failed (${response.statusCode}).`;
          reject(new Error(message));
          return;
        }
        resolve(data);
      });
    });
    request.setTimeout(15000, () => request.destroy(new Error('Atlassian request timed out.')));
    request.on('error', (error) => reject(new Error(`Atlassian connection failed: ${error.message}`)));
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

function asList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.projects)) return data.projects;
  if (Array.isArray(data?.issueTypes)) return data.issueTypes;
  if (Array.isArray(data?.values)) return data.values;
  if (Array.isArray(data?.fields)) return data.fields;
  if (Array.isArray(data?.reports)) return data.reports;
  if (Array.isArray(data?.runs)) return data.runs;
  if (Array.isArray(data?.statuses)) return data.statuses;
  if (Array.isArray(data?.tests)) return data.tests;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function toPlainText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(toPlainText).filter(Boolean).join(' ');
  if (typeof value === 'object') return [value.text, toPlainText(value.content)].filter(Boolean).join(' ');
  return '';
}

function jiraDescriptionDocument(steps, requestedType) {
  const lines = steps.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: requestedType === 'request' ? 'Request details' : 'Steps to reproduce' }] },
      ...lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }))
    ]
  };
}

function jiraDefaultFieldValue(fieldKey, field, context) {
  if (field.defaultValue !== undefined && field.defaultValue !== null) return field.defaultValue;
  const name = String(field.name || fieldKey).toLowerCase();
  const allowedValues = field.allowedValues || [];
  if (fieldKey === 'summary' || /summary|title/.test(name)) return context.summary;
  if (fieldKey === 'description' || /description/.test(name)) return context.description;
  if (/steps to reproduce|reproduction steps/.test(name)) return context.steps;
  if (/environment/.test(name)) return context.environment || 'Not specified';
  if (/priority/.test(name) && allowedValues.length) {
    return allowedValues.find((value) => /medium|normal/i.test(value.name || value.value || '')) || allowedValues[0];
  }
  if (/labels/.test(name) || fieldKey === 'labels') return ['qa-copilot'];
  if (allowedValues.length) {
    const defaultOption = allowedValues.find((value) => value.isDefault || value.default === true) || allowedValues[0];
    return field.schema?.type === 'array' ? [defaultOption] : defaultOption;
  }
  if (/reporter|requester|assignee|owner/.test(name) && context.actor?.accountId) return { accountId: context.actor.accountId };
  if (/outcome|expected result|acceptance criteria/.test(name)) return `Verify behavior against the supplied details: ${context.steps.slice(0, 500)}`;
  if (/date|due/.test(name) && /date/.test(field.schema?.type || '')) {
    const mentionedDate = context.steps.match(/\b\d{4}-\d{2}-\d{2}\b/);
    return mentionedDate?.[0] || new Date().toISOString().slice(0, 10);
  }
  if (field.schema?.type === 'date' || field.schema?.type === 'datetime') return new Date().toISOString().slice(0, 10);
  if (field.schema?.type === 'number' || field.schema?.type === 'integer') return 0;
  if (field.schema?.type === 'boolean') return false;
  if (field.schema?.type === 'array') return [];
  if (field.schema?.type === 'string' || field.schema?.type === 'text') return 'Not specified';
  return undefined;
}

function jiraCreateFieldEntries(fieldDefinitions) {
  if (Array.isArray(fieldDefinitions)) {
    return fieldDefinitions.map((field) => [field?.fieldId || field?.key, field]);
  }
  return Object.entries(fieldDefinitions || {}).map(([key, field]) => [field?.fieldId || field?.key || key, field]);
}

async function testRailGetAll(credentials, endpoint) {
  const records = [];
  const pageSize = 250;
  const maxRecords = 5000;
  while (records.length < maxRecords) {
    const response = await testRailRequest(credentials, `${endpoint}&limit=${pageSize}&offset=${records.length}`);
    const page = asList(response);
    records.push(...page);
    if (Array.isArray(response) || page.length < pageSize) break;
  }
  return { records, truncated: records.length >= maxRecords };
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

ipcMain.handle('testrail-connect', async (_event, credentials) => {
  if (!credentials?.instanceUrl?.trim() || !credentials?.username?.trim() || !credentials?.apiKey?.trim()) {
    throw new Error('Enter your TestRail URL, account email, and API key.');
  }
  let instanceUrl;
  try {
    instanceUrl = new URL(credentials.instanceUrl.trim());
    if (instanceUrl.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('Enter a valid TestRail URL beginning with https://.');
  }

  const candidate = {
    instanceUrl: instanceUrl.origin + instanceUrl.pathname.replace(/\/+$/, ''),
    username: credentials.username.trim(),
    apiKey: credentials.apiKey.trim()
  };
  const [projects, caseFields, resultFields] = await Promise.all([
    testRailRequest(candidate, 'get_projects'),
    testRailRequest(candidate, 'get_case_fields'),
    testRailRequest(candidate, 'get_result_fields')
  ]);
  testRailCredentials = candidate;
  return {
    projects: asList(projects),
    caseFields: asList(caseFields),
    resultFields: asList(resultFields)
  };
});

ipcMain.handle('testrail-project-data', async (_event, projectId) => {
  if (!testRailCredentials) throw new Error('Connect to TestRail first.');
  if (!/^\d+$/.test(String(projectId))) throw new Error('Select a valid TestRail project.');
  const [project, reportsResult, runsResult, statusesResult] = await Promise.allSettled([
    testRailRequest(testRailCredentials, `get_project/${projectId}`),
    testRailRequest(testRailCredentials, `get_reports/${projectId}`),
    testRailRequest(testRailCredentials, `get_runs/${projectId}&limit=10`),
    testRailRequest(testRailCredentials, 'get_statuses')
  ]);
  if (project.status === 'rejected') throw project.reason;
  const runs = runsResult.status === 'fulfilled' ? asList(runsResult.value) : [];
  runs.sort((first, second) => {
    const firstDate = new Date(first.completed_on || first.created_on || 0).getTime();
    const secondDate = new Date(second.completed_on || second.created_on || 0).getTime();
    return secondDate - firstDate;
  });
  let unlinkedTests = [];
  let testLinkError = '';
  let testsTruncated = false;
  if (runs[0]) {
    const [testsResult, resultsResult] = await Promise.allSettled([
      testRailGetAll(testRailCredentials, `get_tests/${runs[0].id}`),
      testRailGetAll(testRailCredentials, `get_results_for_run/${runs[0].id}`)
    ]);
    if (testsResult.status === 'fulfilled' && resultsResult.status === 'fulfilled') {
      const latestResults = new Map();
      for (const result of resultsResult.value.records) {
        const current = latestResults.get(result.test_id);
        const resultTime = Number(result.created_on) || Number(result.id) || 0;
        const currentTime = Number(current?.created_on) || Number(current?.id) || 0;
        if (!current || resultTime > currentTime) latestResults.set(result.test_id, result);
      }
      unlinkedTests = testsResult.value.records
        .filter((test) => ![test.defects, latestResults.get(test.id)?.defects].some((defects) => String(defects || '').trim()))
        .map((test) => ({
          caseId: test.case_id,
          title: test.title || `Test ${test.case_id || test.id}`,
          statusId: latestResults.get(test.id)?.status_id ?? test.status_id,
          testId: test.id
        }));
      testsTruncated = testsResult.value.truncated || resultsResult.value.truncated;
    } else {
      testLinkError = testsResult.status === 'rejected'
        ? testsResult.reason.message
        : resultsResult.reason.message;
    }
  }
  return {
    project: project.value,
    reports: reportsResult.status === 'fulfilled' ? asList(reportsResult.value) : [],
    reportsError: reportsResult.status === 'rejected' ? reportsResult.reason.message : '',
    runs,
    runsError: runsResult.status === 'rejected' ? runsResult.reason.message : '',
    statuses: statusesResult.status === 'fulfilled' ? asList(statusesResult.value) : [],
    unlinkedTests,
    testLinkError,
    testsTruncated
  };
});

ipcMain.handle('testrail-disconnect', () => { testRailCredentials = null; return true; });

ipcMain.handle('atlassian-connect', async (_event, credentials) => {
  if (!credentials?.siteUrl?.trim() || !credentials?.email?.trim() || !credentials?.apiToken?.trim()) {
    throw new Error('Enter your Atlassian site URL, account email, and API token.');
  }
  let siteUrl;
  try {
    siteUrl = new URL(credentials.siteUrl.trim());
    if (siteUrl.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('Enter a valid Atlassian Cloud URL beginning with https://.');
  }
  const candidate = {
    siteUrl: siteUrl.origin,
    email: credentials.email.trim(),
    apiToken: credentials.apiToken.trim()
  };
  const [spacesResult, jiraProjectsResult] = await Promise.allSettled([
    atlassianRequest(candidate, '/wiki/rest/api/space?limit=250'),
    atlassianRequest(candidate, '/rest/api/3/project/search?maxResults=100&orderBy=name')
  ]);
  if (spacesResult.status === 'rejected') throw spacesResult.reason;
  atlassianCredentials = candidate;
  return {
    spaces: asList(spacesResult.value),
    jiraProjects: jiraProjectsResult.status === 'fulfilled' ? asList(jiraProjectsResult.value) : [],
    jiraProjectsError: jiraProjectsResult.status === 'rejected' ? jiraProjectsResult.reason.message : ''
  };
});

async function createJiraIssue(request, requestedType) {
  if (!atlassianCredentials) throw new Error('Connect to Atlassian first.');
  const projectKey = String(request?.projectKey || '').trim();
  const requestedSummary = String(request?.summary || '').trim();
  const steps = String(request?.steps || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(projectKey)) throw new Error('Select a valid Jira project.');
  if (!requestedSummary) throw new Error('Enter a Jira summary.');
  if (requestedSummary.length > 255) throw new Error('Keep the Jira summary under 255 characters.');
  if (!steps) throw new Error(requestedType === 'request' ? 'Enter request details.' : 'Enter the steps to reproduce.');
  if (steps.length > 20000) throw new Error('Keep the details under 20,000 characters.');

  const encodedProjectKey = encodeURIComponent(projectKey);
  const issueTypesResponse = await atlassianRequest(atlassianCredentials, `/rest/api/3/issue/createmeta/${encodedProjectKey}/issuetypes?startAt=0&maxResults=100`);
  const issueTypes = asList(issueTypesResponse);
  const requestedIssueType = requestedType === 'request'
    ? issueTypes.find((issueType) => /request/i.test(issueType.name || ''))
    : issueTypes.find((issueType) => /^bug$/i.test(issueType.name || '')) || issueTypes.find((issueType) => /defect/i.test(issueType.name || ''));
  if (!requestedIssueType) {
    const expectedType = requestedType === 'request' ? 'Request' : 'Bug or Defect';
    throw new Error(`The Jira project ${projectKey} has no ${expectedType} issue type available.`);
  }

  const metadata = await atlassianRequest(atlassianCredentials, `/rest/api/3/issue/createmeta/${encodedProjectKey}/issuetypes/${encodeURIComponent(String(requestedIssueType.id))}`);
  const actorResult = await Promise.allSettled([atlassianRequest(atlassianCredentials, '/rest/api/3/myself')]);
  const actor = actorResult[0].status === 'fulfilled' ? actorResult[0].value : null;
  const fieldDefinitions = jiraCreateFieldEntries(metadata.fields);
  const summary = requestedSummary;
  const description = jiraDescriptionDocument(steps, requestedType);
  const fields = {
    project: { key: projectKey },
    issuetype: { id: String(requestedIssueType.id) },
    summary,
    description
  };
  const context = { summary, steps, description, actor };
  const unfilledRequiredFields = [];
  for (const [fieldKey, field] of fieldDefinitions) {
    if (!fieldKey || !/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldKey)) {
      if (field?.required) unfilledRequiredFields.push(field.name || `field ${fieldKey || 'without an ID'}`);
      continue;
    }
    if (!field.required || fields[fieldKey] !== undefined) continue;
    const value = jiraDefaultFieldValue(fieldKey, field, context);
    if (value === undefined) unfilledRequiredFields.push(field.name || fieldKey);
    else fields[fieldKey] = value;
  }
  if (unfilledRequiredFields.length) {
    throw new Error(`Jira requires additional fields that have no configured default: ${unfilledRequiredFields.join(', ')}. Set project defaults in Jira before creating this ${requestedType}.`);
  }

  const created = await atlassianRequest(atlassianCredentials, '/rest/api/3/issue', {
    method: 'POST',
    body: { fields }
  });
  const issueDetails = await Promise.allSettled([
    atlassianRequest(atlassianCredentials, `/rest/api/3/issue/${encodeURIComponent(created.key)}?fields=summary,status,assignee,reporter,updated,issuetype,priority,description`)
  ]);
  const issue = issueDetails[0].status === 'fulfilled' ? issueDetails[0].value : null;
  const issueFields = issue?.fields || {};
  return {
    issue: {
      key: created.key,
      id: created.id,
      summary: issueFields.summary || summary,
      status: issueFields.status?.name || 'Created',
      issueType: issueFields.issuetype?.name || requestedIssueType.name,
      priority: issueFields.priority?.name || 'Unprioritized',
      reporter: issueFields.reporter?.displayName || 'Unknown reporter',
      assignee: issueFields.assignee?.displayName || '',
      updated: issueFields.updated || '',
      description: toPlainText(issueFields.description),
      projectKey
    }
  };
}

ipcMain.handle('jira-create-bug', async (_event, request) => createJiraIssue(request, 'bug'));
ipcMain.handle('jira-create-request', async (_event, request) => createJiraIssue(request, 'request'));

ipcMain.handle('atlassian-project-data', async (_event, selection) => {
  if (!atlassianCredentials) throw new Error('Connect to Atlassian first.');
  if (!selection?.spaceKey?.trim()) throw new Error('Select a Confluence space.');
  const spaceKey = selection.spaceKey.trim();
  const pagesPath = `/wiki/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&type=page&limit=50&expand=body.storage,history,version`;
  const [spaceResult, pagesResult] = await Promise.allSettled([
    atlassianRequest(atlassianCredentials, `/wiki/rest/api/space/${encodeURIComponent(spaceKey)}`),
    atlassianRequest(atlassianCredentials, pagesPath)
  ]);
  if (spaceResult.status === 'rejected') throw spaceResult.reason;
  if (pagesResult.status === 'rejected') throw pagesResult.reason;

  const pages = asList(pagesResult.value);
  const commentsByPage = await Promise.allSettled(pages.map((page) =>
    atlassianRequest(atlassianCredentials, `/wiki/rest/api/content/${encodeURIComponent(page.id)}/child/comment?limit=25&expand=body.storage,history,version`)
  ));
  const reviewPoints = [];
  commentsByPage.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    for (const comment of asList(result.value)) {
      reviewPoints.push({
        pageId: pages[index].id,
        pageTitle: pages[index].title,
        author: comment.version?.by?.displayName || comment.history?.createdBy?.displayName || 'Team member',
        created: comment.history?.createdDate || comment.version?.when || '',
        text: toPlainText(comment.body?.storage?.value)
      });
    }
  });

  let issues = [];
  let issuesError = '';
  const jiraProjectKey = String(selection.jiraProjectKey || '').trim();
  if (jiraProjectKey) {
    const jql = `project = "${jiraProjectKey.replace(/[^A-Za-z0-9_-]/g, '')}" ORDER BY created DESC`;
    const search = new URLSearchParams({ jql, maxResults: '25', fields: 'summary,status,assignee,reporter,created,updated,issuetype,priority,description' });
    try {
      const jiraData = await atlassianRequest(atlassianCredentials, `/rest/api/3/search/jql?${search.toString()}`);
      issues = (jiraData.issues || []).map((issue) => ({
        key: issue.key,
        summary: issue.fields?.summary || '',
        status: issue.fields?.status?.name || 'Unknown',
        issueType: issue.fields?.issuetype?.name || 'Issue',
        priority: issue.fields?.priority?.name || 'Unprioritized',
        reporter: issue.fields?.reporter?.displayName || 'Unknown reporter',
        assignee: issue.fields?.assignee?.displayName || '',
        created: issue.fields?.created || '',
        updated: issue.fields?.updated || '',
        description: toPlainText(issue.fields?.description)
      }));
    } catch (error) {
      issuesError = error.message;
    }
  }

  const referencedIssueKeys = [...new Set(pages.flatMap((page) => {
    const pageText = `${page.title || ''} ${page.body?.storage?.value || ''} ${reviewPoints.filter((point) => point.pageId === page.id).map((point) => point.text).join(' ')}`;
    return pageText.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) || [];
  }))].slice(0, 50);
  const foundIssueKeys = new Set(issues.map((issue) => issue.key));
  const missingIssueKeys = referencedIssueKeys.filter((key) => !foundIssueKeys.has(key));
  if (missingIssueKeys.length) {
    try {
      const linkedJql = `key in (${missingIssueKeys.map((key) => `"${key}"`).join(', ')})`;
      const linkedSearch = new URLSearchParams({ jql: linkedJql, maxResults: '50', fields: 'summary,status,reporter,assignee,updated,issuetype,priority' });
      const linkedData = await atlassianRequest(atlassianCredentials, `/rest/api/3/search/jql?${linkedSearch.toString()}`);
      issues.push(...(linkedData.issues || []).map((issue) => ({
        key: issue.key,
        summary: issue.fields?.summary || '',
        status: issue.fields?.status?.name || 'Unknown',
        issueType: issue.fields?.issuetype?.name || 'Issue',
        priority: issue.fields?.priority?.name || 'Unprioritized',
        reporter: issue.fields?.reporter?.displayName || 'Unknown reporter',
        assignee: issue.fields?.assignee?.displayName || '',
        created: issue.fields?.created || '',
        updated: issue.fields?.updated || '',
        description: toPlainText(issue.fields?.description)
      })));
    } catch (error) {
      if (!issuesError) issuesError = error.message;
    }
  }
  const issuesByKey = new Map(issues.map((issue) => [issue.key, issue]));
  const pagesWithDetails = pages.map((page) => {
    const pageReviewPoints = reviewPoints.filter((point) => point.pageId === page.id);
    const createdBy = page.history?.createdBy?.displayName || 'Unknown';
    const updatedBy = page.history?.lastUpdated?.by?.displayName || page.version?.by?.displayName || 'Unknown';
    const pageText = `${page.title || ''} ${page.body?.storage?.value || ''} ${pageReviewPoints.map((point) => point.text).join(' ')}`;
    const linkedBugKeys = [...new Set(pageText.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) || [])];
    return {
      id: page.id,
      title: page.title,
      stakeholders: [...new Set([createdBy, updatedBy, ...pageReviewPoints.map((point) => point.author)].filter((name) => name && name !== 'Unknown'))],
      reviewPoints: pageReviewPoints,
      linkedBugs: linkedBugKeys.map((key) => issuesByKey.get(key)).filter((issue) => issue && /bug/i.test(issue.issueType)),
      body: toPlainText(page.body?.storage?.value),
      bodyHtml: page.body?.storage?.value || ''
    };
  });

  return {
    space: spaceResult.value,
    pages: pagesWithDetails,
    reviewPoints,
    issues,
    issuesError,
    commentErrors: commentsByPage.filter((result) => result.status === 'rejected').length
  };
});

ipcMain.handle('atlassian-disconnect', () => { atlassianCredentials = null; return true; });

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('will-quit', () => { githubToken = ''; testRailCredentials = null; atlassianCredentials = null; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
