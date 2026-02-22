/**
 * OpenClaw Popup Script
 *
 * Provides a UI for controlling the extension:
 *  - Screenshot capture & download
 *  - Set-of-Mark labelling
 *  - DOM snapshot / accessibility tree
 *  - JavaScript evaluation
 *  - Log viewer
 */

'use strict';

// ── Utilities ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

/** Appends a line to a log output element. */
function appendLog(containerEl, text, cssClass) {
  const line = document.createElement('span');
  if (cssClass) line.className = cssClass;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}\n`;
  containerEl.appendChild(line);
  containerEl.scrollTop = containerEl.scrollHeight;
}

function prettyJSON(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

const logEl = $('log-output');

function logInfo(msg)  { appendLog(logEl, msg, 'log-ok');    console.log('[OpenClaw Popup]', msg); }
function logWarn(msg)  { appendLog(logEl, msg, 'log-warn');  console.warn('[OpenClaw Popup]', msg); }
function logError(msg) { appendLog(logEl, msg, 'log-error'); console.error('[OpenClaw Popup]', msg); }

// ── Tab switching ──────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Status badge ──────────────────────────────────────────────────────────────

const statusBadge = $('status-badge');

async function pingActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { setStatus('no tab', 'error'); return; }
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
    if (resp?.ok) {
      setStatus('ready', 'ready');
      logInfo(`Connected to ${resp.url}`);
    } else {
      setStatus('error', 'error');
    }
  } catch (err) {
    setStatus('unavailable', 'error');
    logWarn('Content script not reachable: ' + err.message);
  }
}

function setStatus(text, cls) {
  statusBadge.textContent = text;
  statusBadge.className   = cls;
}

// ── Screenshot ─────────────────────────────────────────────────────────────────

let lastScreenshotUrl = null;

$('btn-screenshot').addEventListener('click', async () => {
  try {
    $('btn-screenshot').disabled = true;
    const resp = await chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' });
    if (!resp.ok) throw new Error(resp.error);
    lastScreenshotUrl = resp.dataUrl;
    const preview = $('screenshot-preview');
    preview.src = resp.dataUrl;
    preview.classList.add('visible');
    $('screenshot-actions').style.display = '';
    logInfo('Screenshot captured');
  } catch (err) {
    logError('Screenshot failed: ' + err.message);
  } finally {
    $('btn-screenshot').disabled = false;
  }
});

$('btn-download-screenshot').addEventListener('click', async () => {
  if (!lastScreenshotUrl) return;
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      url:  lastScreenshotUrl,
      filename: `openclaw-screenshot-${Date.now()}.png`,
    });
    if (!resp.ok) throw new Error(resp.error);
    logInfo('Screenshot download started, id: ' + resp.downloadId);
  } catch (err) {
    logError('Download failed: ' + err.message);
  }
});

// ── Set-of-Mark ────────────────────────────────────────────────────────────────

$('btn-marks').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SET_OF_MARKS' });
    if (!resp.ok) throw new Error(resp.error);
    $('marks-count').textContent = `${resp.count} elements labelled`;
    logInfo(`Set-of-Mark applied: ${resp.count} elements`);
  } catch (err) {
    logError('Set-of-Mark failed: ' + err.message);
  }
});

$('btn-clear-marks').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_SET_OF_MARKS' });
    $('marks-count').textContent = '';
    logInfo('Marks cleared');
  } catch (err) {
    logError('Clear marks failed: ' + err.message);
  }
});

// ── DOM tab ────────────────────────────────────────────────────────────────────

const domOutput = $('output');

$('btn-dom-snapshot').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp  = await chrome.tabs.sendMessage(tab.id, { type: 'GET_DOM_SNAPSHOT', options: { maxElements: 200 } });
    if (!resp.ok) throw new Error(resp.error);
    domOutput.textContent = prettyJSON(resp.snapshot);
    logInfo(`DOM snapshot: ${resp.snapshot.captured} elements`);
  } catch (err) {
    domOutput.textContent = 'Error: ' + err.message;
    logError(err.message);
  }
});

$('btn-a11y-tree').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp  = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ACCESSIBILITY_TREE' });
    if (!resp.ok) throw new Error(resp.error);
    domOutput.textContent = prettyJSON(resp.tree);
    logInfo('Accessibility tree fetched');
  } catch (err) {
    domOutput.textContent = 'Error: ' + err.message;
    logError(err.message);
  }
});

$('btn-page-info').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp  = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
    if (!resp.ok) throw new Error(resp.error);
    domOutput.textContent = prettyJSON(resp);
    logInfo('Page info fetched');
  } catch (err) {
    domOutput.textContent = 'Error: ' + err.message;
    logError(err.message);
  }
});

$('btn-find').addEventListener('click', async () => {
  try {
    const selector = $('find-selector').value.trim() || '*';
    const [tab]    = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp     = await chrome.tabs.sendMessage(tab.id, {
      type: 'FIND_ELEMENTS',
      selector,
      limit: 50,
    });
    if (!resp.ok) throw new Error(resp.error);
    domOutput.textContent = prettyJSON(resp.elements);
    logInfo(`Found ${resp.elements.length} elements for "${selector}"`);
  } catch (err) {
    domOutput.textContent = 'Error: ' + err.message;
    logError(err.message);
  }
});

// ── Eval tab ───────────────────────────────────────────────────────────────────

const evalOutput = $('eval-output');

async function runEval(world) {
  const code = $('eval-input').value.trim();
  if (!code) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp  = await chrome.runtime.sendMessage({
      type:  'EVALUATE_SCRIPT',
      tabId: tab.id,
      code:  `return (${code})`,
      world,
    });
    evalOutput.textContent = prettyJSON(resp.ok ? resp.result : resp.error);
    logInfo(`Eval (${world}) completed`);
  } catch (err) {
    evalOutput.textContent = 'Error: ' + err.message;
    logError(err.message);
  }
}

$('btn-eval').addEventListener('click', () => runEval('ISOLATED'));
$('btn-eval-inject').addEventListener('click', () => runEval('MAIN'));

// ── Logs tab ───────────────────────────────────────────────────────────────────

$('btn-clear-logs').addEventListener('click', () => {
  logEl.textContent = '';
});

// ── Init ───────────────────────────────────────────────────────────────────────

pingActiveTab();
