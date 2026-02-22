/**
 * OpenClaw Background Service Worker
 *
 * Handles: screenshot capture, file downloads, tab management,
 * message routing between popup/content scripts, and debugging.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let currentLogLevel = LOG_LEVELS.INFO;

// ── Logging ──────────────────────────────────────────────────────────────────

function log(level, ...args) {
  if (LOG_LEVELS[level] >= currentLogLevel) {
    const prefix = `[OpenClaw BG][${level}]`;
    if (level === 'ERROR') console.error(prefix, ...args);
    else if (level === 'WARN') console.warn(prefix, ...args);
    else console.log(prefix, ...args);
  }
}

// ── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('DEBUG', 'Received message:', message.type, 'from', sender.tab?.id ?? 'popup');

  const handlers = {
    CAPTURE_SCREENSHOT:   () => handleScreenshot(message, sender, sendResponse),
    DOWNLOAD_FILE:        () => handleDownload(message, sendResponse),
    GET_TABS:             () => handleGetTabs(sendResponse),
    NAVIGATE:             () => handleNavigate(message, sendResponse),
    EVALUATE_SCRIPT:      () => handleEvaluateScript(message, sender, sendResponse),
    SET_LOG_LEVEL:        () => handleSetLogLevel(message, sendResponse),
    RELAY_TO_CONTENT:     () => handleRelayToContent(message, sender, sendResponse),
    PING:                 () => sendResponse({ ok: true, version: chrome.runtime.getManifest().version }),
  };

  const handler = handlers[message.type];
  if (handler) {
    try {
      handler();
    } catch (err) {
      log('ERROR', 'Handler error:', err);
      sendResponse({ ok: false, error: err.message });
    }
  } else {
    log('WARN', 'Unknown message type:', message.type);
    sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
  }

  // Return true to keep the message channel open for async responses
  return true;
});

// ── Screenshot ────────────────────────────────────────────────────────────────

async function handleScreenshot(message, sender, sendResponse) {
  try {
    const tabId = message.tabId ?? sender.tab?.id;
    const tab = tabId
      ? await chrome.tabs.get(tabId)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

    if (!tab) {
      sendResponse({ ok: false, error: 'No active tab found' });
      return;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: message.format ?? 'png',
      quality: message.quality ?? 90,
    });

    log('INFO', 'Screenshot captured for tab', tab.id);
    sendResponse({ ok: true, dataUrl, tabId: tab.id, url: tab.url });
  } catch (err) {
    log('ERROR', 'Screenshot failed:', err);
    sendResponse({ ok: false, error: err.message });
  }
}

// ── File Download ─────────────────────────────────────────────────────────────

async function handleDownload(message, sendResponse) {
  try {
    const { url, filename, conflictAction = 'uniquify' } = message;
    if (!url) throw new Error('url is required');

    const downloadId = await chrome.downloads.download({
      url,
      filename,
      conflictAction,
      saveAs: message.saveAs ?? false,
    });

    log('INFO', 'Download started, id:', downloadId);
    sendResponse({ ok: true, downloadId });
  } catch (err) {
    log('ERROR', 'Download failed:', err);
    sendResponse({ ok: false, error: err.message });
  }
}

// ── Tab Management ────────────────────────────────────────────────────────────

async function handleGetTabs(sendResponse) {
  try {
    const tabs = await chrome.tabs.query({});
    const summary = tabs.map(({ id, url, title, active, status }) => ({
      id, url, title, active, status,
    }));
    sendResponse({ ok: true, tabs: summary });
  } catch (err) {
    log('ERROR', 'Get tabs failed:', err);
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleNavigate(message, sendResponse) {
  try {
    const { url, tabId, newTab = false } = message;
    if (!url) throw new Error('url is required');

    if (newTab) {
      const tab = await chrome.tabs.create({ url });
      sendResponse({ ok: true, tabId: tab.id });
    } else {
      const id = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (!id) throw new Error('No target tab');
      await chrome.tabs.update(id, { url });
      sendResponse({ ok: true, tabId: id });
    }
  } catch (err) {
    log('ERROR', 'Navigate failed:', err);
    sendResponse({ ok: false, error: err.message });
  }
}

// ── Script Evaluation ─────────────────────────────────────────────────────────

async function handleEvaluateScript(message, sender, sendResponse) {
  try {
    const tabId = message.tabId ?? sender.tab?.id
      ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (!tabId) throw new Error('No target tab');

    // Security note: `message.code` is executed in the target tab's context.
    // This capability is intentional for AI-agent use; ensure only trusted
    // agents have access to this extension's messaging API.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: new Function(message.code), // eslint-disable-line no-new-func
      world: message.world ?? 'MAIN',
    });

    sendResponse({ ok: true, result: results?.[0]?.result });
  } catch (err) {
    log('ERROR', 'Script eval failed:', err);
    sendResponse({ ok: false, error: err.message });
  }
}

// ── Relay to Content Script ────────────────────────────────────────────────────

async function handleRelayToContent(message, sender, sendResponse) {
  try {
    const tabId = message.tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (!tabId) throw new Error('No target tab');

    const response = await chrome.tabs.sendMessage(tabId, message.payload);
    sendResponse({ ok: true, response });
  } catch (err) {
    log('ERROR', 'Relay failed:', err);
    sendResponse({ ok: false, error: err.message });
  }
}

// ── Log Level ─────────────────────────────────────────────────────────────────

function handleSetLogLevel(message, sendResponse) {
  const lvl = LOG_LEVELS[message.level?.toUpperCase()];
  if (lvl !== undefined) {
    currentLogLevel = lvl;
    sendResponse({ ok: true });
  } else {
    sendResponse({ ok: false, error: 'Invalid log level' });
  }
}

// ── Install/Update Lifecycle ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  log('INFO', 'Extension installed/updated, reason:', reason);
});

log('INFO', 'OpenClaw background service worker started v' + chrome.runtime.getManifest().version);
