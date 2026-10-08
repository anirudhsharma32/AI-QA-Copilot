const apiKeyInput = document.querySelector('#api-key');
const modelInput = document.querySelector('#model');
const qaInput = document.querySelector('#qa-input');
const charCount = document.querySelector('#char-count');
const fileName = document.querySelector('#file-name');
const responseArea = document.querySelector('#response-area');
const statusLine = document.querySelector('#status-line');
const statusText = document.querySelector('#status-text');
const generateButton = document.querySelector('#generate-button');
const testRailUrlInput = document.querySelector('#testrail-url');
const testRailUsernameInput = document.querySelector('#testrail-username');
const testRailApiKeyInput = document.querySelector('#testrail-api-key');
const testRailData = document.querySelector('#testrail-data');
const testRailConnectButton = document.querySelector('#testrail-connect');
const testRailDisconnectButton = document.querySelector('#testrail-disconnect');
const atlassianUrlInput = document.querySelector('#atlassian-url');
const atlassianEmailInput = document.querySelector('#atlassian-email');
const atlassianTokenInput = document.querySelector('#atlassian-token');
const atlassianData = document.querySelector('#atlassian-data');
const atlassianConnectButton = document.querySelector('#atlassian-connect');
const atlassianDisconnectButton = document.querySelector('#atlassian-disconnect');
let selectedFileName = '';
let lastResponse = '';
let lastTestCases = '';
let lastAtlassianDashboardData = null;
let testRailFields = { caseFields: [], resultFields: [] };
let testRailPieChart = null;
let testRailTrendChart = null;

function setStatus(message, type = '') {
  statusText.textContent = message;
  statusLine.className = `status-line ${type}`.trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
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
      if (line.startsWith('## ')) {
        const heading = line.slice(3);
        const isScenarioHeading = heading.trim().toLowerCase() === 'test scenarios';
        html += isScenarioHeading
          ? `<div class="section-heading"><h2>${inlineMarkdown(heading)}</h2><button class="test-cases-button" type="button" data-action="generate-test-cases">Generate Test Cases <span>&#8599;</span></button></div>`
          : `<h2>${inlineMarkdown(heading)}</h2>`;
      }
      else if (line.trim()) html += `<p>${inlineMarkdown(line)}</p>`;
    }
  });
  if (inList) html += '</ul>'; if (inTable) html += '</table>';
  return html;
}
function inlineMarkdown(value) { return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>'); }

qaInput.addEventListener('input', () => { charCount.textContent = `${qaInput.value.length.toLocaleString()} / 30,000`; });

function renderTestRailFields(title, fields) {
  const items = fields.map((field) => {
    const requiredContexts = (field.configs || [])
      .filter((configuration) => configuration.options?.is_required)
      .map((configuration) => configuration.context?.is_global
        ? 'all projects'
        : configuration.context?.project_ids?.length
          ? `project ${configuration.context.project_ids.join(', ')}`
          : 'configured');
    const required = field.is_required === true || field.required_on_submit === true || requiredContexts.length > 0;
    const name = escapeHtml(field.label || field.name || field.system_name || 'Unnamed field');
    const scope = requiredContexts.length ? `: ${escapeHtml(requiredContexts.join('; '))}` : '';
    return `<li>${name}${required ? ` <strong>(required${scope})</strong>` : ''}</li>`;
  }).join('');
  return `<h4>${title}</h4>${items ? `<ul>${items}</ul>` : '<p>No fields returned.</p>'}`;
}

function destroyTestRailCharts() {
  testRailPieChart?.destroy();
  testRailTrendChart?.destroy();
  testRailPieChart = null;
  testRailTrendChart = null;
}

function getRunStatusCounts(run, statuses) {
  const statusList = statuses.length ? statuses : [
    { id: 1, name: 'Passed' }, { id: 2, name: 'Blocked' }, { id: 3, name: 'Untested' },
    { id: 4, name: 'Retest' }, { id: 5, name: 'Failed' }
  ];
  return statusList.map((status) => {
    const standardCountKeys = { 1: 'passed_count', 2: 'blocked_count', 3: 'untested_count', 4: 'retest_count', 5: 'failed_count' };
    const key = standardCountKeys[status.id] || `custom_status${status.id - 5}_count`;
    return { label: status.label || status.name, count: Number(run?.[key]) || 0 };
  });
}

function formatTestRailDate(timestamp) {
  if (!timestamp) return 'Not recorded';
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAtlassianDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function extractGDPoints(page) {
  if (page.bodyHtml) {
    const document = new DOMParser().parseFromString(page.bodyHtml, 'text/html');
    const tableRows = [...document.querySelectorAll('table tr')];
    if (tableRows.length) {
      const firstCells = [...tableRows[0].querySelectorAll('th, td')].map((cell) => cell.textContent.trim().toLowerCase());
      const hasHeader = Boolean(tableRows[0].querySelector('th')) || firstCells.some((cell) => /\b(gd points?|details?|status|description)\b/.test(cell));
      const pointColumn = firstCells.findIndex((cell) => /\b(gd points?|game design points?|points?|objectives?|scenarios?)\b/.test(cell));
      const detailColumn = firstCells.findIndex((cell) => /\b(details?|description|acceptance criteria|notes?)\b/.test(cell));
      const statusColumn = firstCells.findIndex((cell) => /\b(status|state|progress)\b/.test(cell));
      const points = tableRows.slice(hasHeader ? 1 : 0).map((row, index) => {
        const cells = [...row.querySelectorAll('th, td')].map((cell) => cell.textContent.trim());
        const resolvedPointColumn = pointColumn >= 0 ? pointColumn : 0;
        const point = cells[resolvedPointColumn] || `GD point ${index + 1}`;
        const details = detailColumn >= 0
          ? cells[detailColumn]
          : cells.filter((_cell, cellIndex) => cellIndex !== resolvedPointColumn && cellIndex !== statusColumn).join(' | ');
        return { point, details: details || point, status: statusColumn >= 0 ? cells[statusColumn] || 'Not specified' : 'Not specified' };
      }).filter((point) => point.point || point.details);
      if (points.length) return points;
    }

    const points = [];
    let section = '';
    for (const element of document.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li')) {
      const text = element.textContent.trim();
      if (!text || (element.tagName === 'P' && element.closest('li'))) continue;
      if (/^H[1-6]$/.test(element.tagName)) {
        section = text;
      } else {
        const statusMatch = text.match(/^status\s*:\s*(.+)$/i);
        if (statusMatch && points.length) {
          points[points.length - 1].status = statusMatch[1].trim();
          continue;
        }
        points.push({
          point: section || `GD point ${points.length + 1}`,
          details: text,
          status: statusMatch?.[1]?.trim() || 'Not specified'
        });
      }
    }
    if (points.length) return points;
  }

  const text = String(page.body || '').trim();
  return text ? [{ point: 'Playtest notes', details: text, status: 'Not specified' }] : [];
}

function extractProjectFields(page) {
  const aliases = [
    ['driver', /^(driver|project driver|project lead|owner)$/i],
    ['approver', /^(approver|approval owner)$/i],
    ['contributors', /^(contributors?|project contributors?)$/i],
    ['informed', /^(informed|informed stakeholders?)$/i],
    ['objective', /^(objective|project objective|goal)$/i],
    ['dueDate', /^(due date|target date|deadline)$/i],
    ['keyOutcomes', /^(key outcomes?|outcomes?|expected outcomes?)$/i],
    ['status', /^(status|project status|state)$/i]
  ];
  const fields = {};
  const addField = (label, value) => {
    const field = aliases.find(([, pattern]) => pattern.test(label.trim().replace(/:$/, '')))?.[0];
    const cleanValue = String(value || '').trim();
    if (field && cleanValue) fields[field] = [...new Set([...(fields[field] || []), cleanValue])];
  };

  if (page.bodyHtml) {
    const document = new DOMParser().parseFromString(page.bodyHtml, 'text/html');
    for (const row of document.querySelectorAll('table tr')) {
      const cells = [...row.querySelectorAll('th, td')].map((cell) => cell.textContent.trim());
      if (cells.length > 1) addField(cells[0], cells.slice(1).join('; '));
    }
    for (const element of document.body.querySelectorAll('p, li')) {
      const match = element.textContent.trim().match(/^([^:]{2,40}):\s*(.+)$/);
      if (match) addField(match[1], match[2]);
    }
  }
  for (const line of String(page.body || '').split(/\r?\n/)) {
    const match = line.trim().match(/^([^:]{2,40}):\s*(.+)$/);
    if (match) addField(match[1], match[2]);
  }
  return fields;
}

function classifyJiraStatus(status) {
  const normalized = String(status || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (normalized.includes('reopen')) return 'Reopened';
  if (/in progress|progress|started|development|testing|review/.test(normalized)) return 'In Progress';
  if (/^(new|open|to do|todo|backlog|selected|queued)$/.test(normalized)) return 'New';
  return 'Other';
}

function renderJiraDashboard(data) {
  const jiraProjectKey = data.jiraProjectKey || '';
  const jiraProjectName = data.jiraProjectName || jiraProjectKey;
  const issues = data.issues || [];
  const buckets = ['New', 'In Progress', 'Reopened', 'Other'];
  const counts = Object.fromEntries(buckets.map((bucket) => [bucket, issues.filter((issue) => classifyJiraStatus(issue.status) === bucket).length]));
  const rows = issues.map((issue) => {
    const category = classifyJiraStatus(issue.status);
    return `<tr><td class="jira-key">${escapeHtml(issue.key)}</td><td>${escapeHtml(issue.issueType || 'Issue')}</td><td><strong>${escapeHtml(issue.summary || 'Untitled ticket')}</strong>${issue.description ? `<small>${escapeHtml(`${issue.description.slice(0, 220)}${issue.description.length > 220 ? '…' : ''}`)}</small>` : ''}</td><td><span class="jira-state jira-state-${category.toLowerCase().replace(/\s+/g, '-')}" >${escapeHtml(issue.status)}</span></td><td>${escapeHtml(issue.priority || 'Unprioritized')}</td><td>${escapeHtml(issue.reporter || 'Unknown reporter')}</td><td>${escapeHtml(issue.assignee || 'Unassigned')}</td><td>${escapeHtml(formatAtlassianDate(issue.updated))}</td></tr>`;
  }).join('');
  const selectionMessage = jiraProjectKey
    ? data.issuesError
      ? `<p class="dashboard-empty">Could not load Jira tickets: ${escapeHtml(data.issuesError)}</p>`
      : rows
        ? `<div class="manager-table-wrap jira-dashboard-table-wrap"><table class="manager-table jira-dashboard-table"><thead><tr><th>Key</th><th>Type</th><th>Ticket details</th><th>Status</th><th>Priority</th><th>Reporter</th><th>Assignee</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p class="dashboard-empty">No tickets found for this Jira project.</p>'
    : '<p class="dashboard-empty">Choose a Jira project in the connection panel and fetch project details to show its tickets here.</p>';

  return `<section class="jira-project-dashboard"><div class="jira-dashboard-heading"><div><p class="eyebrow">JIRA / DELIVERY STATUS</p><h3>${escapeHtml(jiraProjectName || 'Jira project details')}</h3><p>Recent project tickets by workflow status</p></div>${jiraProjectKey ? `<span class="jira-project-key">${escapeHtml(jiraProjectKey)}</span>` : ''}</div>
    ${jiraProjectKey && !data.issuesError ? `<div class="jira-status-summary">${buckets.map((bucket) => `<div class="jira-status-card jira-status-card-${bucket.toLowerCase().replace(/\s+/g, '-')}"><span>${bucket === 'Other' ? 'Other statuses' : bucket}</span><strong>${counts[bucket]}</strong></div>`).join('')}</div>` : ''}
    ${selectionMessage}
  </section>`;
}

function renderAtlassianDashboard(data) {
  destroyTestRailCharts();
  const allPages = data.pages || [];
  const pages = allPages.filter((page) => /\bplay[\s-]*tests?\b/i.test(page.title || ''));
  const issues = data.issues || [];
  const projectNames = data.projectNames?.length
    ? data.projectNames
    : [...new Set(allPages.map((page) => page.projectName || page.projectKey).filter(Boolean))];
  const projectKeys = data.projectKeys || [];
  const projectProfiles = projectNames.map((name, index) => {
    const projectKey = projectKeys[index];
    const projectPages = allPages.filter((page) => (projectKey && page.projectKey === projectKey) || page.projectName === name || page.projectKey === name);
    const parsedFields = projectPages.map(extractProjectFields);
    const valuesFor = (field) => [...new Set(parsedFields.flatMap((fields) => fields[field] || []))];
    const projectIssues = issues.filter((issue) => issue.projectKey === projectKey);
    const activeContributors = [...new Set([
      ...projectPages.flatMap((page) => page.stakeholders || []),
      ...projectIssues.flatMap((issue) => [issue.reporter, issue.assignee]).filter((person) => person && person !== 'Unknown reporter')
    ])];
    return {
      name,
      driver: valuesFor('driver'),
      approver: valuesFor('approver'),
      contributors: valuesFor('contributors').length ? valuesFor('contributors') : activeContributors,
      informed: valuesFor('informed'),
      objective: valuesFor('objective'),
      dueDate: valuesFor('dueDate'),
      keyOutcomes: valuesFor('keyOutcomes'),
      status: valuesFor('status')
    };
  });
  const stakeholders = [...new Set([
    ...pages.flatMap((page) => page.stakeholders || []),
    ...issues.flatMap((issue) => [issue.reporter, issue.assignee]).filter((name) => name && name !== 'Unknown reporter')
  ])].sort((first, second) => first.localeCompare(second));
  const reviewPoints = pages.flatMap((page) => (page.reviewPoints || []).map((point) => ({
    ...point,
    projectName: page.projectName || page.projectKey || 'Game project',
    playtestTitle: page.title || 'Playtest'
  })));
  const priorityReviewPoints = reviewPoints.filter((point) => /\b(blocker|blocking|risk|critical|must|concern|decision|action|follow.?up|issue|delay|unresolved)\b/i.test(point.text || ''));
  const importantPoints = (priorityReviewPoints.length ? priorityReviewPoints : reviewPoints).slice(0, 5);
  const linkedBugKeys = [...new Set(pages.flatMap((page) => (page.linkedBugs || []).map((bug) => bug.key)))];
  const stakeholderItems = stakeholders.map((name) => `<li>${escapeHtml(name)}</li>`).join('');
  const projectItems = projectNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('');
  const importantPointItems = importantPoints.map((point) => `<li><strong>${escapeHtml(point.projectName)} · ${escapeHtml(point.playtestTitle)}</strong><span>${escapeHtml(point.author || 'Team member')}: ${escapeHtml(point.text || 'Review point without text.')}</span></li>`).join('');
  const projectProfileRows = projectProfiles.map((profile) => {
    const renderValues = (values) => values.length ? values.map(escapeHtml).join('<br>') : '<span class="table-muted">Not specified</span>';
    return `<tr><th>${escapeHtml(profile.name)}</th><td>${renderValues(profile.driver)}</td><td>${renderValues(profile.approver)}</td><td>${renderValues(profile.contributors)}</td><td>${renderValues(profile.informed)}</td><td>${renderValues(profile.objective)}</td><td>${renderValues(profile.dueDate)}</td><td>${renderValues(profile.keyOutcomes)}</td><td>${renderValues(profile.status)}</td></tr>`;
  }).join('');
  const pageRows = pages.map((page) => {
    const reviewPoints = page.reviewPoints || [];
    const projectIssues = issues.filter((issue) => issue.projectKey === page.projectKey);
    const stakeholders = [...new Set([
      ...(page.stakeholders || []),
      ...projectIssues.flatMap((issue) => [issue.reporter, issue.assignee]).filter(Boolean)
    ])];
    const bugs = page.linkedBugs || [];
    const gdPoints = extractGDPoints(page);
    const playtestButton = `<button class="playtest-detail-button" type="button" data-action="toggle-playtest-detail" data-page-id="${escapeHtml(String(page.id))}" data-point-count="${gdPoints.length}" aria-expanded="false">View GD points (${gdPoints.length})</button>`;
    const reviewContent = reviewPoints.length
      ? `<details class="table-disclosure"><summary>${reviewPoints.length} review point(s)</summary><div class="table-disclosure-content">${reviewPoints.map((point) => `<article><strong>${escapeHtml(point.author || 'Team member')}</strong><small>${escapeHtml(formatAtlassianDate(point.created))}</small><p>${escapeHtml(point.text || 'Comment has no text.')}</p></article>`).join('')}</div></details>`
      : '<span class="table-muted">No review points</span>';
    const bugContent = bugs.length
      ? `<ul class="linked-bug-list">${bugs.map((bug) => `<li><strong>${escapeHtml(bug.key)}</strong><span>${escapeHtml(bug.summary || 'Bug')}</span><small>${escapeHtml(bug.status || 'Status unavailable')} · ${escapeHtml(bug.priority || 'Unprioritized')}</small></li>`).join('')}</ul>`
      : '<span class="table-muted">No linked bugs found</span>';
    const row = `<tr><td>${escapeHtml(page.projectName || data.space.name || data.space.key || 'Confluence project')}</td><td><strong>${escapeHtml(page.title || 'Untitled playtest')}</strong>${playtestButton}</td><td>${stakeholders.length ? stakeholders.map((name) => `<span class="contributor-name">${escapeHtml(name)}</span>`).join('') : '<span class="table-muted">No stakeholders identified</span>'}</td><td>${reviewContent}</td><td>${bugContent}</td></tr>`;
    const gdPointRows = gdPoints.length
      ? gdPoints.map((point) => `<tr><td>${escapeHtml(point.point)}</td><td>${escapeHtml(point.details)}</td><td><span class="gd-status-tag">${escapeHtml(point.status || 'Not specified')}</span></td></tr>`).join('')
      : '<tr><td colspan="3">No GD points found in this playtest.</td></tr>';
    const detailRow = `<tr class="playtest-detail-row" data-page-id="${escapeHtml(String(page.id))}" hidden><td colspan="5"><div class="playtest-detail-heading"><strong>${escapeHtml(page.projectName || data.space.name || data.space.key || 'Game project')}</strong><span>${escapeHtml(page.title || 'Untitled playtest')}</span></div><div class="gd-points-table-wrap"><table class="playtest-detail-table"><thead><tr><th>GD points</th><th>Details</th><th>Status</th></tr></thead><tbody>${gdPointRows}</tbody></table></div></td></tr>`;
    return `${row}${detailRow}`;
  }).join('');
  const space = data.space || {};

  responseArea.innerHTML = `<div class="response-content atlassian-dashboard">
    <div class="dashboard-title"><div><p class="eyebrow">ATLASSIAN / GAME PROJECT PLAYTESTS</p><h2>${escapeHtml(space.name || space.key || 'Game projects')}</h2><p>${escapeHtml(space.description?.plain?.value || space.description || 'Project playtests, stakeholders, review points, and linked bugs.')}</p></div><span class="project-state">${pages.length} playtests</span></div>
    <section class="project-overview" aria-label="Game project overview">
      <div class="overview-metrics"><div><span>Projects</span><strong>${projectNames.length}</strong></div><div><span>Playtests</span><strong>${pages.length}</strong></div><div><span>Stakeholders</span><strong>${stakeholders.length}</strong></div><div><span>Review points</span><strong>${reviewPoints.length}</strong></div><div><span>Linked bugs</span><strong>${linkedBugKeys.length}</strong></div></div>
      <div class="overview-lists"><section><h3>Confluence projects</h3>${projectItems ? `<ul>${projectItems}</ul>` : '<p>No projects identified.</p>'}</section><section><h3>Stakeholders</h3>${stakeholderItems ? `<ul>${stakeholderItems}</ul>` : '<p>No stakeholders identified.</p>'}</section><section class="overview-highlights"><h3>Important review points</h3>${importantPointItems ? `<ul>${importantPointItems}</ul>` : '<p>No review comments are available for the selected playtests.</p>'}</section></div>
      <div class="project-profile"><h3>Stakeholder and delivery overview</h3><div class="manager-table-wrap project-profile-wrap"><table class="manager-table project-profile-table"><thead><tr><th>Game project</th><th>Driver</th><th>Approver</th><th>Contributors</th><th>Informed</th><th>Objective</th><th>Due date</th><th>Key outcomes</th><th>Status</th></tr></thead><tbody>${projectProfileRows || '<tr><td colspan="9">No project details available.</td></tr>'}</tbody></table></div></div>
    </section>
    <section class="atlassian-dashboard-section artifact-table-section"><div class="dashboard-section-title"><div><h3>Game projects and playtests</h3><p>Stakeholders, review points, and linked bugs</p></div></div>${pageRows ? `<div class="manager-table-wrap artifact-table-wrap"><table class="manager-table artifact-table"><thead><tr><th>Game project</th><th class="gd-point-column">Playtest<button class="gd-table-toggle" id="toggle-gd-points" data-count="${pages.length}" type="button" aria-expanded="false" aria-controls="gd-points-rows">Show all playtests (${pages.length})</button></th><th>Stakeholders</th><th>Review points</th><th>Linked bugs</th></tr></thead><tbody id="gd-points-rows" hidden>${pageRows}</tbody></table></div>` : '<p class="dashboard-empty">No pages titled as playtests were found in the selected game projects.</p>'}</section>
    ${renderJiraDashboard(data)}
  </div>`;
}

function renderTestRailDashboard(data) {
  destroyTestRailCharts();
  const project = data.project;
  const runs = data.runs || [];
  const reports = data.reports || [];
  const latestRun = runs[0];
  const statuses = data.statuses || [];
  const unlinkedTests = data.unlinkedTests || [];
  const statusCounts = getRunStatusCounts(latestRun, statuses);
  const totalTests = statusCounts.reduce((total, status) => total + status.count, 0);
  const passed = statusCounts.find((status) => status.label.toLowerCase() === 'passed')?.count || 0;
  const passRate = totalTests ? Math.round((passed / totalTests) * 100) : 0;
  const trendRuns = [...runs].reverse();
  const trendLabels = trendRuns.map((run) => run.name || `Run ${run.id}`);
  const trendValues = trendRuns.map((run) => {
    const counts = getRunStatusCounts(run, statuses);
    const runTotal = counts.reduce((total, status) => total + status.count, 0);
    return runTotal ? Math.round((counts.find((status) => status.label.toLowerCase() === 'passed')?.count || 0) / runTotal * 100) : null;
  });
  const reportItems = reports.map((report) => `<li><span>${escapeHtml(report.name || report.title || `Report ${report.id}`)}</span><small>${escapeHtml(report.description || 'TestRail report')}</small></li>`).join('');
  const runRows = runs.slice(0, 6).map((run) => {
    const counts = getRunStatusCounts(run, statuses);
    const runTotal = counts.reduce((total, status) => total + status.count, 0);
    const runPassed = counts.find((status) => status.label.toLowerCase() === 'passed')?.count || 0;
    const runFailed = counts.find((status) => status.label.toLowerCase() === 'failed')?.count || 0;
    return `<tr><td>${escapeHtml(run.name || `Run ${run.id}`)}</td><td>${escapeHtml(formatTestRailDate(run.completed_on || run.created_on))}</td><td>${runTotal}</td><td>${runPassed}</td><td>${runFailed}</td></tr>`;
  }).join('');
  const unlinkedRows = unlinkedTests.slice(0, 100).map((test) => {
    const status = statuses.find((item) => Number(item.id) === Number(test.statusId));
    return `<tr><td>${escapeHtml(String(test.caseId ?? '—'))}</td><td>${escapeHtml(test.title)}</td><td>${escapeHtml(status?.label || status?.name || 'Not run')}</td></tr>`;
  }).join('');
  const unlinkedState = data.testLinkError
    ? `<p class="dashboard-empty">Could not verify bug links: ${escapeHtml(data.testLinkError)}</p>`
    : unlinkedTests.length
      ? `<p class="unlinked-summary"><strong>${unlinkedTests.length.toLocaleString()}</strong> case(s) in the latest run have no defect IDs on their latest result.${data.testsTruncated ? ' The scan reached the 5,000-record safety limit.' : ''}${unlinkedTests.length > 100 ? ` Showing the first 100 of ${unlinkedTests.length.toLocaleString()}.` : ''}</p><div class="manager-table-wrap unlinked-table-wrap"><table class="manager-table"><thead><tr><th>Case ID</th><th>Test case</th><th>Latest status</th></tr></thead><tbody>${unlinkedRows}</tbody></table></div>`
      : '<p class="unlinked-summary clear">No unlinked cases found in the latest run.</p>';
  const projectState = project.is_completed ? 'Completed' : 'Active';
  const suiteMode = { 1: 'Single suite', 2: 'Single suite with baselines', 3: 'Multiple suites' }[project.suite_mode] || 'Not specified';

  responseArea.innerHTML = `<div class="response-content testrail-dashboard">
    <div class="dashboard-title"><div><p class="eyebrow">TESTRAIL / PROJECT HEALTH</p><h2>${escapeHtml(project.name || 'Project overview')}</h2><p>${escapeHtml(project.announcement || 'Project quality snapshot and recent execution health.')}</p></div><span class="project-state ${project.is_completed ? 'complete' : ''}">${projectState}</span></div>
    <section class="manager-metrics" aria-label="Project summary">
      <div class="metric"><span>Latest run</span><strong>${latestRun ? escapeHtml(latestRun.name || `#${latestRun.id}`) : 'No runs'}</strong><small>${latestRun ? escapeHtml(formatTestRailDate(latestRun.completed_on || latestRun.created_on)) : 'No run data available'}</small></div>
      <div class="metric"><span>Tests in latest run</span><strong>${totalTests.toLocaleString()}</strong><small>${latestRun ? `${passed.toLocaleString()} passed · ${passRate}% pass rate` : 'Awaiting first run'}</small></div>
      <div class="metric"><span>Reports</span><strong>${reports.length}</strong><small>Available in this project</small></div>
      <div class="metric"><span>Test organization</span><strong>${escapeHtml(suiteMode)}</strong><small>${runs.length} recent runs loaded</small></div>
    </section>
    <section class="dashboard-charts" aria-label="Test execution charts">
      <div class="dashboard-chart"><div class="dashboard-section-title"><div><h3>Latest run status</h3><p>${latestRun ? escapeHtml(latestRun.name || `Run ${latestRun.id}`) : 'Status distribution'}</p></div></div>${totalTests ? '<div class="chart-wrap chart-doughnut"><canvas id="testrail-status-chart" aria-label="Latest test run status pie chart"></canvas></div>' : '<div class="chart-empty">No test status counts were returned for the latest run.</div>'}</div>
      <div class="dashboard-chart"><div class="dashboard-section-title"><div><h3>Pass-rate trend</h3><p>Recent runs, chronological</p></div></div>${trendValues.some((value) => value !== null) ? '<div class="chart-wrap"><canvas id="testrail-trend-chart" aria-label="Pass rate trend line chart"></canvas></div>' : '<div class="chart-empty">Run history will appear here once TestRail returns execution counts.</div>'}</div>
    </section>
    <section class="dashboard-lower">
      <div class="dashboard-section"><div class="dashboard-section-title"><div><h3>Recent test runs</h3><p>Execution status at a glance</p></div></div>${runRows ? `<div class="manager-table-wrap"><table class="manager-table"><thead><tr><th>Run</th><th>Date</th><th>Total</th><th>Passed</th><th>Failed</th></tr></thead><tbody>${runRows}</tbody></table></div>` : `<p class="dashboard-empty">${escapeHtml(data.runsError || 'No test runs found for this project.')}</p>`}</div>
      <div class="dashboard-section"><div class="dashboard-section-title"><div><h3>Project details</h3><p>Manager reference</p></div></div><dl class="project-details"><dt>State</dt><dd>${projectState}</dd><dt>Suite mode</dt><dd>${escapeHtml(suiteMode)}</dd><dt>Reports available</dt><dd>${reports.length}</dd><dt>Project ID</dt><dd>${escapeHtml(String(project.id ?? 'Not provided'))}</dd></dl><h4>Reports</h4>${data.reportsError ? `<p class="dashboard-empty">${escapeHtml(data.reportsError)}</p>` : reportItems ? `<ul class="report-list">${reportItems}</ul>` : '<p class="dashboard-empty">No reports available.</p>'}</div>
    </section>
    <section class="dashboard-section unlinked-cases"><div class="dashboard-section-title"><div><h3>Test cases without bug links</h3><p>Based on defect IDs on each case's latest result in the latest run</p></div><span class="unlinked-count ${unlinkedTests.length ? 'has-unlinked' : ''}">${unlinkedTests.length}</span></div>${unlinkedState}</section>
    <section class="dashboard-required-fields"><div class="dashboard-section-title"><div><h3>Required TestRail fields</h3><p>Fields the team must complete</p></div></div><div class="required-fields-grid">${renderTestRailFields('Test cases', data.caseFields || [])}${renderTestRailFields('Test results', data.resultFields || [])}</div></section>
  </div>`;

  if (totalTests) {
    testRailPieChart = new Chart(document.querySelector('#testrail-status-chart'), {
      type: 'doughnut',
      data: { labels: statusCounts.map((status) => status.label), datasets: [{ data: statusCounts.map((status) => status.count), backgroundColor: ['#3a9b79', '#e3a33b', '#c7d0ce', '#6389a7', '#df6b59', '#7e74a8'], borderColor: '#fff', borderWidth: 3, hoverOffset: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 13, font: { size: 10 } } }, tooltip: { callbacks: { label: (context) => ` ${context.label}: ${context.raw}` } } } }
    });
  }
  if (trendValues.some((value) => value !== null)) {
    testRailTrendChart = new Chart(document.querySelector('#testrail-trend-chart'), {
      type: 'line',
      data: { labels: trendLabels, datasets: [{ label: 'Passed', data: trendValues, borderColor: '#23645c', backgroundColor: 'rgba(35,100,92,.12)', pointBackgroundColor: '#ee795e', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 4, fill: true, tension: .32, spanGaps: true }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100, ticks: { callback: (value) => `${value}%`, font: { size: 9 } }, grid: { color: '#edf1ef' } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, font: { size: 9 } } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => ` Pass rate: ${context.raw}%` } } } }
    });
  }
}

testRailConnectButton.addEventListener('click', async () => {
  testRailConnectButton.disabled = true;
  testRailData.textContent = 'Connecting to TestRail and loading projects and field definitions...';
  try {
    const result = await window.qaCopilot.connectTestRail({
      instanceUrl: testRailUrlInput.value,
      username: testRailUsernameInput.value,
      apiKey: testRailApiKeyInput.value
    });
    testRailApiKeyInput.value = '';
    testRailFields = { caseFields: result.caseFields, resultFields: result.resultFields };
    const projectOptions = result.projects.map((project) => `<option value="${Number(project.id)}">${escapeHtml(project.name || `Project ${project.id}`)}</option>`).join('');
    testRailData.innerHTML = `<p>Connected. ${result.projects.length} project(s) available.</p>
      <label for="testrail-project">Project</label><select id="testrail-project">${projectOptions}</select>
      <button class="github-button" id="testrail-fetch" type="button" ${projectOptions ? '' : 'disabled'}>Fetch project data</button>
      <div id="testrail-project-details"></div>`;
    testRailConnectButton.hidden = true;
    testRailDisconnectButton.hidden = false;
    setStatus('Connected to TestRail', 'success');
  } catch (error) {
    testRailData.textContent = error.message;
    setStatus(error.message, 'error');
  } finally {
    testRailConnectButton.disabled = false;
  }
});

testRailData.addEventListener('click', async (event) => {
  if (event.target.id !== 'testrail-fetch') return;
  const projectSelect = document.querySelector('#testrail-project');
  const projectDetails = document.querySelector('#testrail-project-details');
  event.target.disabled = true;
  projectDetails.textContent = 'Loading project details and reports...';
  try {
    const result = await window.qaCopilot.getTestRailProjectData(projectSelect.value);
    renderTestRailDashboard({ ...result, ...testRailFields });
    projectDetails.textContent = 'Project overview and execution dashboard loaded in QA readout.';
    setStatus('TestRail project data loaded', 'success');
  } catch (error) {
    projectDetails.textContent = error.message;
    setStatus(error.message, 'error');
  } finally {
    event.target.disabled = false;
  }
});

testRailDisconnectButton.addEventListener('click', async () => {
  await window.qaCopilot.disconnectTestRail();
  testRailData.replaceChildren();
  testRailConnectButton.hidden = false;
  testRailDisconnectButton.hidden = true;
  testRailApiKeyInput.value = '';
  testRailFields = { caseFields: [], resultFields: [] };
  destroyTestRailCharts();
  if (responseArea.querySelector('.testrail-dashboard')) {
    responseArea.innerHTML = '<div class="empty-state"><div class="empty-glyph">+</div><h3>Your analysis will land here.</h3><p>Connect TestRail and select a project to view its manager dashboard.</p></div>';
  }
  setStatus('TestRail disconnected', 'success');
});

atlassianConnectButton.addEventListener('click', async () => {
  atlassianConnectButton.disabled = true;
  atlassianData.textContent = 'Connecting to Atlassian and loading Confluence spaces...';
  try {
    const result = await window.qaCopilot.connectAtlassian({
      siteUrl: atlassianUrlInput.value,
      email: atlassianEmailInput.value,
      apiToken: atlassianTokenInput.value
    });
    atlassianTokenInput.value = '';
    const spaceOptions = result.spaces.map((space) => `<option value="${escapeHtml(`${space.name || space.key} (${space.key})`)}" data-key="${escapeHtml(String(space.key))}"></option>`).join('');
    const jiraProjects = result.jiraProjects || [];
    const jiraOptions = jiraProjects.map((project) => `<option value="${escapeHtml(`${project.name || project.key} (${project.key})`)}" data-key="${escapeHtml(String(project.key))}"></option>`).join('');
    atlassianData.innerHTML = `<p>Connected. ${result.spaces.length} Confluence space(s) available.</p>
      <label for="atlassian-space-search">Game project space</label><input id="atlassian-space-search" type="search" list="atlassian-space-options" autocomplete="off" placeholder="Search Confluence spaces" required><datalist id="atlassian-space-options">${spaceOptions}</datalist><input id="atlassian-space" type="hidden"><p class="field-hint">Search and choose a space to load its project details.</p>
      <div class="field-group"><label for="jira-project-search">Target Jira project <span>required</span></label><input id="jira-project-search" type="search" list="jira-project-options" autocomplete="off" placeholder="Search Jira projects" required><datalist id="jira-project-options">${jiraOptions}</datalist><input id="jira-project-key" type="hidden">${result.jiraProjectsError ? `<p class="field-hint">Jira projects unavailable: ${escapeHtml(result.jiraProjectsError)}</p>` : `<p class="field-hint">Select a project before creating a bug or request. ${jiraProjects.length} accessible project(s).</p>`}</div>
      <section class="jira-bug-create"><h3>Create Jira issue</h3><p>Choose the target project, enter a summary and steps. QA Copilot fills Jira-required defaults.</p><label for="jira-bug-summary">Summary</label><input id="jira-bug-summary" type="text" maxlength="255" required placeholder="Short description of the issue or request"><label for="jira-bug-steps">Steps to replicate</label><textarea id="jira-bug-steps" maxlength="20000" rows="5" required placeholder="1. Open the affected screen\n2. Perform the action\n3. Describe the result"></textarea><div class="jira-create-actions"><button class="github-button" id="create-jira-bug" type="button" disabled>Create bug</button><button class="github-button" id="create-jira-request" type="button" disabled>Create request</button></div><p id="jira-bug-create-status" role="status" aria-live="polite"></p></section>
      <button class="github-button" id="atlassian-fetch" type="button" ${result.spaces.length ? '' : 'disabled'}>Fetch project details</button>
      <div id="atlassian-fetch-status"></div>`;
    atlassianConnectButton.hidden = true;
    atlassianDisconnectButton.hidden = false;
    setStatus('Connected to Atlassian', 'success');
  } catch (error) {
    atlassianData.textContent = error.message;
    setStatus(error.message, 'error');
  } finally {
    atlassianConnectButton.disabled = false;
  }
});

function syncAtlassianAutocomplete(inputId, listId, hiddenId) {
  const searchInput = document.querySelector(`#${inputId}`);
  const keyInput = document.querySelector(`#${hiddenId}`);
  const optionList = document.querySelector(`#${listId}`);
  if (!searchInput || !keyInput || !optionList) return;
  const selectedOption = [...optionList.options].find((option) => option.value.toLocaleLowerCase() === searchInput.value.trim().toLocaleLowerCase());
  const selectedKey = selectedOption?.dataset.key || '';
  if (keyInput.value === selectedKey) return;
  keyInput.value = selectedKey;
  keyInput.dispatchEvent(new Event('change', { bubbles: true }));
}

atlassianData.addEventListener('input', (event) => {
  const autocompleteBindings = {
    'atlassian-space-search': ['atlassian-space-options', 'atlassian-space'],
    'jira-project-search': ['jira-project-options', 'jira-project-key']
  };
  const binding = autocompleteBindings[event.target.id];
  if (binding) syncAtlassianAutocomplete(event.target.id, binding[0], binding[1]);
});

atlassianData.addEventListener('change', (event) => {
  const autocompleteBindings = {
    'atlassian-space-search': ['atlassian-space-options', 'atlassian-space'],
    'jira-project-search': ['jira-project-options', 'jira-project-key']
  };
  const binding = autocompleteBindings[event.target.id];
  if (binding) {
    syncAtlassianAutocomplete(event.target.id, binding[0], binding[1]);
    return;
  }
  if (event.target.id === 'atlassian-space') {
    if (event.target.value) document.querySelector('#atlassian-fetch')?.click();
    return;
  }
  if (event.target.id === 'jira-project-key') {
    for (const buttonId of ['#create-jira-bug', '#create-jira-request']) {
      const createButton = document.querySelector(buttonId);
      if (createButton) createButton.disabled = !event.target.value;
    }
    if (event.target.value && document.querySelector('#atlassian-space')?.value) {
      document.querySelector('#atlassian-fetch')?.click();
    }
  }
});

atlassianData.addEventListener('click', async (event) => {
  const createBugButton = event.target.closest('#create-jira-bug');
  const createRequestButton = event.target.closest('#create-jira-request');
  const createIssueButton = createBugButton || createRequestButton;
  if (createIssueButton) {
    const requestedType = createRequestButton ? 'request' : 'bug';
    const createButtons = [createBugButton, createRequestButton].filter(Boolean);
    const projectSelect = document.querySelector('#jira-project-key');
    const summaryInput = document.querySelector('#jira-bug-summary');
    const stepsInput = document.querySelector('#jira-bug-steps');
    const createStatus = document.querySelector('#jira-bug-create-status');
    if (!projectSelect?.value) {
      createStatus.textContent = 'Select a Jira project first.';
      return;
    }
    if (!summaryInput.value.trim()) {
      createStatus.textContent = 'Enter a summary for this Jira issue.';
      summaryInput.focus();
      return;
    }
    if (!stepsInput.value.trim()) {
      createStatus.textContent = 'Enter steps to replicate.';
      stepsInput.focus();
      return;
    }
    createButtons.forEach((button) => { button.disabled = true; });
    createStatus.textContent = `Checking Jira-required fields and creating the ${requestedType}...`;
    try {
      const projectKey = projectSelect.value;
      const projectName = document.querySelector('#jira-project-search')?.value.trim() || projectKey;
      const createJiraIssue = requestedType === 'request' ? window.qaCopilot.createJiraRequest : window.qaCopilot.createJiraBug;
      const result = await createJiraIssue({ projectKey, summary: summaryInput.value, steps: stepsInput.value });
      const currentDashboard = lastAtlassianDashboardData || {
        space: { name: projectName, key: projectKey, type: 'Jira project' },
        projectNames: [projectName],
        projectKeys: [projectKey],
        pages: [],
        issues: []
      };
      const existingProjects = new Map((currentDashboard.projectKeys || []).map((key, index) => [key, currentDashboard.projectNames?.[index] || key]));
      existingProjects.set(projectKey, projectName);
      lastAtlassianDashboardData = {
        ...currentDashboard,
        projectNames: [...existingProjects.values()],
        projectKeys: [...existingProjects.keys()],
        jiraProjectKey: projectKey,
        jiraProjectName: projectName,
        issues: [...(currentDashboard.issues || []).filter((issue) => issue.projectKey === projectKey && issue.key !== result.issue.key), { ...result.issue, projectKey }]
      };
      renderAtlassianDashboard(lastAtlassianDashboardData);
      summaryInput.value = '';
      stepsInput.value = '';
      createStatus.textContent = `Ticket ${result.issue.key} created successfully and added to the Jira dashboard.`;
      setStatus(`Jira ticket ${result.issue.key} created successfully`, 'success');
    } catch (error) {
      createStatus.textContent = error.message;
      setStatus(error.message, 'error');
    } finally {
      createButtons.forEach((button) => { button.disabled = !projectSelect.value; });
    }
    return;
  }
  if (event.target.id !== 'atlassian-fetch') return;
  const selectedSpace = document.querySelector('#atlassian-space');
  const spaceSearch = document.querySelector('#atlassian-space-search');
  const spaceKeys = selectedSpace?.value ? [selectedSpace.value] : [];
  const jiraProjectSelect = document.querySelector('#jira-project-key');
  const jiraProjectSearch = document.querySelector('#jira-project-search');
  const jiraProjectKey = jiraProjectSelect?.value || '';
  const jiraProjectName = jiraProjectSearch?.value.trim() || '';
  const fetchStatus = document.querySelector('#atlassian-fetch-status');
  const fetchButton = document.querySelector('#atlassian-fetch');
  if (!spaceKeys.length) {
    fetchStatus.textContent = 'Select a Confluence space.';
    return;
  }
  event.target.disabled = true;
  selectedSpace.disabled = true;
  spaceSearch.disabled = true;
  jiraProjectSelect.disabled = true;
  jiraProjectSearch.disabled = true;
  fetchStatus.textContent = 'Loading Confluence details and Jira tickets...';
  try {
    const projectResults = await Promise.all(spaceKeys.map((spaceKey) => window.qaCopilot.getAtlassianProjectData({ spaceKey, jiraProjectKey })));
    const projectNames = projectResults.map((result) => result.space.name || result.space.key);
    const combined = {
      space: { name: projectResults.length === 1 ? projectNames[0] : `${projectResults.length} game projects`, key: spaceKeys.join(', '), type: 'Confluence' },
      projectNames,
      projectKeys: spaceKeys,
      pages: projectResults.flatMap((result) => result.pages.map((page) => ({ ...page, projectName: result.space.name || result.space.key, projectKey: result.space.key }))),
      issues: [...new Map(projectResults.flatMap((result) => result.issues.map((issue) => [`${result.space.key}:${issue.key}`, { ...issue, projectKey: result.space.key }]))).values()],
      issuesError: projectResults.map((result) => result.issuesError).filter(Boolean).join(' '),
      commentErrors: projectResults.reduce((total, result) => total + (result.commentErrors || 0), 0),
      projectCount: projectResults.length,
      jiraProjectKey: jiraProjectKey.trim(),
      jiraProjectName
    };
    lastAtlassianDashboardData = combined;
    renderAtlassianDashboard(combined);
    fetchStatus.textContent = `Project register loaded for ${projectNames.join(', ')}.`;
    setStatus('Atlassian project readout loaded', 'success');
  } catch (error) {
    fetchStatus.textContent = error.message;
    setStatus(error.message, 'error');
  } finally {
    fetchButton.disabled = false;
    selectedSpace.disabled = false;
    spaceSearch.disabled = false;
    jiraProjectSelect.disabled = false;
    jiraProjectSearch.disabled = false;
  }
});

atlassianDisconnectButton.addEventListener('click', async () => {
  await window.qaCopilot.disconnectAtlassian();
  atlassianData.replaceChildren();
  atlassianConnectButton.hidden = false;
  atlassianDisconnectButton.hidden = true;
  atlassianTokenInput.value = '';
  if (responseArea.querySelector('.atlassian-dashboard')) {
    responseArea.innerHTML = '<div class="empty-state"><div class="empty-glyph">+</div><h3>Your analysis will land here.</h3><p>Connect Atlassian and fetch a project readout to review team context here.</p></div>';
  }
  setStatus('Atlassian disconnected', 'success');
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
  destroyTestRailCharts();
  responseArea.innerHTML = '<div class="empty-state"><div class="empty-glyph">...</div><h3>Building your test map.</h3><p>The analysis is running in a background worker. You can keep preparing the brief.</p></div>';
  try {
    lastResponse = await window.qaCopilot.analyze({ apiKey: apiKeyInput.value, model: modelInput.value, input: qaInput.value, fileName: selectedFileName });
    lastTestCases = '';
    responseArea.innerHTML = `<div class="response-content">${markdownToHtml(lastResponse)}</div>`;
    setStatus('Analysis complete · ready to review', 'success');
  } catch (error) {
    responseArea.innerHTML = `<div class="empty-state"><div class="empty-glyph">!</div><h3>Analysis could not run.</h3><p>${escapeHtml(error.message)}</p></div>`;
    setStatus(error.message, 'error');
  } finally { generateButton.disabled = false; generateButton.querySelector('span').textContent = 'Generate QA analysis'; }
});

responseArea.addEventListener('click', async (event) => {
  const gdToggle = event.target.closest('#toggle-gd-points');
  if (gdToggle) {
    const rows = document.querySelector('#gd-points-rows');
    rows.hidden = !rows.hidden;
    gdToggle.setAttribute('aria-expanded', String(!rows.hidden));
    gdToggle.textContent = `${rows.hidden ? 'Show' : 'Hide'} all playtests (${gdToggle.dataset.count})`;
    setStatus(rows.hidden ? 'Playtests hidden' : 'All playtests displayed', 'success');
    return;
  }
  const playtestButton = event.target.closest('[data-action="toggle-playtest-detail"]');
  if (playtestButton) {
    const detailRow = [...responseArea.querySelectorAll('.playtest-detail-row')]
      .find((row) => row.dataset.pageId === playtestButton.dataset.pageId);
    if (!detailRow) return;
    detailRow.hidden = !detailRow.hidden;
    playtestButton.setAttribute('aria-expanded', String(!detailRow.hidden));
    playtestButton.textContent = `${detailRow.hidden ? 'View' : 'Hide'} GD points (${playtestButton.dataset.pointCount})`;
    return;
  }
  const button = event.target.closest('[data-action="generate-test-cases"]');
  if (!button) return;
  if (!apiKeyInput.value.trim()) return setStatus('An API key is required', 'error');
  if (!lastResponse) return setStatus('Generate the QA analysis first', 'error');
  button.disabled = true;
  button.innerHTML = 'Generating...';
  setStatus('Turning test scenarios into executable test cases', 'busy');
  try {
    lastTestCases = await window.qaCopilot.analyze({
      action: 'generate-test-cases',
      apiKey: apiKeyInput.value,
      model: modelInput.value,
      input: lastResponse,
      fileName: selectedFileName
    });
    lastResponse = `${lastResponse}\n\n${lastTestCases}`;
    responseArea.innerHTML = `<div class="response-content">${markdownToHtml(lastResponse)}</div>`;
    setStatus('Test cases generated · ready to execute', 'success');
  } catch (error) {
    button.disabled = false;
    button.innerHTML = 'Generate Test Cases <span>&#8599;</span>';
    setStatus(error.message, 'error');
  }
});

document.querySelector('#clear-button').addEventListener('click', () => { destroyTestRailCharts(); qaInput.value = ''; selectedFileName = ''; lastResponse = ''; lastTestCases = ''; fileName.textContent = 'TXT, CSV, JSON, LOG, PY, JS, JAVA, SQL, DOCS'; charCount.textContent = '0 / 30,000'; responseArea.innerHTML = '<div class="empty-state"><div class="empty-glyph">+</div><h3>Your analysis will land here.</h3><p>Copilot will structure risk, acceptance criteria, scenarios, and the next action into a review-ready brief.</p></div>'; setStatus('Waiting for your QA material'); });
document.querySelector('#copy-button').addEventListener('click', async () => { if (!lastResponse) return setStatus('Generate a response before copying', 'error'); await navigator.clipboard.writeText(lastResponse); setStatus('Response copied to clipboard', 'success'); });
document.querySelector('#save-button').addEventListener('click', async () => { if (!lastResponse) return setStatus('Generate a response before saving', 'error'); try { const saved = await window.qaCopilot.saveResponse(lastResponse); if (saved) setStatus('Response saved successfully', 'success'); } catch (error) { setStatus(error.message, 'error'); } });
document.querySelector('#regenerate-button').addEventListener('click', () => { if (lastResponse) generateButton.click(); else setStatus('Generate an analysis before regenerating', 'error'); });
