/**
 * OpenClaw Content Script
 *
 * Provides: DOM analysis, accessibility tree rendering, Set-of-Mark visual
 * element numbering, element interaction (click/type/scroll), form automation,
 * and stealth mode to mimic human-like behaviour.
 *
 * All state is kept in a single ContentScriptState object to minimise memory
 * footprint and avoid global variable pollution.
 */

(function openClawContentScript() {
  'use strict';

  // ── Guard against double-injection ─────────────────────────────────────────
  if (window.__openClawInjected) return;
  window.__openClawInjected = true;

  // ── Constants ───────────────────────────────────────────────────────────────

  const MARK_ATTR       = 'data-openclaw-mark';
  const MARK_STYLE_ID   = '__openclaw_mark_styles';
  const LOG_PREFIX      = '[OpenClaw CS]';

  // Tags that are interactive / meaningful for automation
  const INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL',
    'DETAILS', 'SUMMARY', 'VIDEO', 'AUDIO',
  ]);

  // Tags with implicit ARIA roles that carry semantic meaning
  const SEMANTIC_ROLES = {
    A:        'link',
    BUTTON:   'button',
    INPUT:    'textbox',
    SELECT:   'combobox',
    TEXTAREA: 'textbox',
    FORM:     'form',
    NAV:      'navigation',
    MAIN:     'main',
    HEADER:   'banner',
    FOOTER:   'contentinfo',
    ASIDE:    'complementary',
    SECTION:  'region',
    ARTICLE:  'article',
    H1: 'heading', H2: 'heading', H3: 'heading',
    H4: 'heading', H5: 'heading', H6: 'heading',
    UL: 'list', OL: 'list', LI: 'listitem',
    TABLE: 'table', TR: 'row', TH: 'columnheader', TD: 'cell',
  };

  // ── Logging ─────────────────────────────────────────────────────────────────

  function log(level, ...args) {
    const fn = level === 'error' ? console.error
             : level === 'warn'  ? console.warn
             : console.log;
    fn(LOG_PREFIX, `[${level.toUpperCase()}]`, ...args);
  }

  // ── Stealth helpers ──────────────────────────────────────────────────────────

  /** Returns a random delay between min and max milliseconds. */
  function randomDelay(min = 30, max = 150) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Moves the simulated mouse towards a target element using small incremental
   * moves to avoid straight-line movement patterns detected by anti-bot scripts.
   * This is purely cosmetic – real pointer events are fired by dispatchEvent.
   */
  async function humanMouseMove(targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const targetX = rect.left + rect.width  / 2 + (Math.random() * 4 - 2);
    const targetY = rect.top  + rect.height / 2 + (Math.random() * 4 - 2);
    targetEl.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true,
      clientX: targetX, clientY: targetY,
    }));
    await sleep(randomDelay(10, 40));
    targetEl.dispatchEvent(new MouseEvent('mouseenter', {
      bubbles: true, cancelable: true,
      clientX: targetX, clientY: targetY,
    }));
  }

  // ── Set-of-Mark (SoM) labelling ──────────────────────────────────────────────

  /** Injects the overlay CSS once. */
  function ensureMarkStyles() {
    if (document.getElementById(MARK_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = MARK_STYLE_ID;
    style.textContent = `
      [${MARK_ATTR}]::before {
        content: attr(${MARK_ATTR});
        position: absolute;
        top: -8px;
        left: -2px;
        z-index: 2147483647;
        background: #1a73e8;
        color: #fff;
        font: bold 10px/14px monospace;
        padding: 1px 4px;
        border-radius: 3px;
        pointer-events: none;
        white-space: nowrap;
      }
      [${MARK_ATTR}] {
        position: relative;
        outline: 2px solid #1a73e8 !important;
        outline-offset: 1px;
      }
    `;
    (document.head ?? document.documentElement).appendChild(style);
  }

  /** Returns visible interactive elements within a root. */
  function getInteractiveElements(root = document) {
    const selector = [
      ...INTERACTIVE_TAGS,
      '[role="button"]', '[role="link"]', '[role="checkbox"]',
      '[role="radio"]',  '[role="tab"]',  '[role="menuitem"]',
      '[contenteditable="true"]', '[tabindex]',
    ].join(',');
    return Array.from(root.querySelectorAll(selector)).filter(isVisible);
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  /**
   * Applies Set-of-Mark numbers to all visible interactive elements.
   * Returns a map of mark-number → element for subsequent interaction.
   */
  function applySetOfMarks(root = document) {
    clearSetOfMarks(root);
    ensureMarkStyles();
    const elements = getInteractiveElements(root);
    const markMap = new Map();
    elements.forEach((el, idx) => {
      const mark = String(idx + 1);
      el.setAttribute(MARK_ATTR, mark);
      markMap.set(mark, el);
    });
    log('info', `Applied ${markMap.size} Set-of-Mark labels`);
    return markMap;
  }

  function clearSetOfMarks(root = document) {
    root.querySelectorAll(`[${MARK_ATTR}]`).forEach(el => el.removeAttribute(MARK_ATTR));
  }

  // ── DOM Analysis ─────────────────────────────────────────────────────────────

  /** Serialises an element to a lightweight descriptor. */
  function describeElement(el) {
    const rect  = el.getBoundingClientRect();
    const tag   = el.tagName;
    const role  = el.getAttribute('role') || SEMANTIC_ROLES[tag] || null;
    const label = el.getAttribute('aria-label')
               || el.getAttribute('aria-labelledby')
               || el.getAttribute('title')
               || el.getAttribute('placeholder')
               || (el.labels && el.labels[0]?.textContent?.trim())
               || el.textContent?.trim().slice(0, 80)
               || null;

    return {
      tag,
      id:       el.id     || null,
      classes:  el.className ? el.className.trim().split(/\s+/) : [],
      role,
      label,
      mark:     el.getAttribute(MARK_ATTR) || null,
      value:    el.value ?? null,
      checked:  el.type === 'checkbox' || el.type === 'radio' ? el.checked : undefined,
      href:     el.href ?? null,
      visible:  isVisible(el),
      rect:     { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    };
  }

  /** Returns a simplified DOM snapshot of the current viewport. */
  function getDomSnapshot(options = {}) {
    const { maxElements = 500, includeHidden = false } = options;
    const elements = Array.from(document.querySelectorAll('*'));
    const relevant = elements
      .filter(el => includeHidden || isVisible(el))
      .slice(0, maxElements)
      .map(describeElement);
    return {
      url:   location.href,
      title: document.title,
      elementCount: elements.length,
      captured: relevant.length,
      elements: relevant,
    };
  }

  // ── Accessibility Tree ────────────────────────────────────────────────────────

  /** Recursively builds an accessibility tree node from an element. */
  function buildA11yNode(el, depth = 0, maxDepth = 10) {
    if (depth > maxDepth) return null;
    const tag   = el.tagName;
    const role  = el.getAttribute('role') || SEMANTIC_ROLES[tag] || tag.toLowerCase();
    const name  = el.getAttribute('aria-label')
               || el.getAttribute('title')
               || el.getAttribute('placeholder')
               || el.textContent?.trim().slice(0, 80)
               || null;

    const node = {
      role,
      name,
      tag,
      mark: el.getAttribute(MARK_ATTR) || null,
      children: [],
    };

    if (el.getAttribute('aria-hidden') === 'true') return null;
    if (!isVisible(el) && depth > 0) return null;

    for (const child of el.children) {
      const childNode = buildA11yNode(child, depth + 1, maxDepth);
      if (childNode) node.children.push(childNode);
    }

    // Prune nodes with no name and no meaningful children
    if (!name && node.children.length === 0 && !INTERACTIVE_TAGS.has(tag)) return null;

    return node;
  }

  function getAccessibilityTree(maxDepth = 8) {
    return {
      url:   location.href,
      title: document.title,
      tree:  buildA11yNode(document.body ?? document.documentElement, 0, maxDepth),
    };
  }

  // ── Element Interaction ───────────────────────────────────────────────────────

  /** Resolves an element from a selector, mark number, or coordinates. */
  function resolveTarget(target) {
    if (!target) throw new Error('target is required');

    if (typeof target.mark === 'string' || typeof target.mark === 'number') {
      const el = document.querySelector(`[${MARK_ATTR}="${target.mark}"]`);
      if (!el) throw new Error(`No element with mark ${target.mark}`);
      return el;
    }
    if (target.selector) {
      const el = document.querySelector(target.selector);
      if (!el) throw new Error(`No element matching "${target.selector}"`);
      return el;
    }
    if (target.xpath) {
      const result = document.evaluate(
        target.xpath, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null,
      );
      if (!result.singleNodeValue) throw new Error(`No element at XPath "${target.xpath}"`);
      return result.singleNodeValue;
    }
    throw new Error('target must have mark, selector, or xpath');
  }

  async function clickElement(target, options = {}) {
    const el = resolveTarget(target);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(randomDelay(50, 120));
    await humanMouseMove(el);

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width  / 2;
    const y = rect.top  + rect.height / 2;

    const eventOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    await sleep(randomDelay(20, 60));
    el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    el.dispatchEvent(new MouseEvent('click',   eventOpts));

    if (options.rightClick) {
      el.dispatchEvent(new MouseEvent('contextmenu', eventOpts));
    }

    log('info', 'Clicked element', el.tagName, target);
    return describeElement(el);
  }

  async function typeInElement(target, text, options = {}) {
    const el = resolveTarget(target);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(randomDelay(30, 80));
    el.focus();
    await sleep(randomDelay(20, 50));

    if (options.clearFirst) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const delay = options.humanDelay !== false;
    for (const char of text) {
      el.dispatchEvent(new KeyboardEvent('keydown',  { key: char, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value += char;
      } else if (el.isContentEditable) {
        // document.execCommand is deprecated; use Selection API instead
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(char));
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          el.textContent += char;
        }
      }
      el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      if (delay) await sleep(randomDelay(30, 100));
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    log('info', 'Typed into element', el.tagName, `"${text.slice(0, 20)}…"`);
    return describeElement(el);
  }

  async function scrollPage(options = {}) {
    const { x = 0, y = 0, behavior = 'smooth', selector } = options;
    if (selector) {
      const el = document.querySelector(selector);
      if (el) el.scrollIntoView({ behavior, block: 'center' });
    } else {
      window.scrollBy({ top: y, left: x, behavior });
    }
    await sleep(randomDelay(100, 200));
    return { scrollX: window.scrollX, scrollY: window.scrollY };
  }

  // ── Form Automation ───────────────────────────────────────────────────────────

  async function fillForm(fields) {
    const results = [];
    for (const { target, value, type } of fields) {
      try {
        const el = resolveTarget(target);
        if (type === 'select') {
          el.focus();
          const option = Array.from(el.options).find(
            o => o.value === value || o.text === value,
          );
          if (option) {
            option.selected = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else if (el.type === 'checkbox' || el.type === 'radio') {
          const shouldCheck = value === true || value === 'true' || value === '1';
          if (el.checked !== shouldCheck) {
            await clickElement(target);
          }
        } else {
          await typeInElement(target, String(value), { clearFirst: true });
        }
        results.push({ target, ok: true });
      } catch (err) {
        log('error', 'fillForm field error:', err.message);
        results.push({ target, ok: false, error: err.message });
      }
    }
    return results;
  }

  // ── Message Handler ───────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    log('debug', 'Content received:', message.type);

    const handle = async () => {
      switch (message.type) {
        case 'PING':
          return { ok: true, url: location.href, title: document.title };

        case 'GET_DOM_SNAPSHOT':
          return { ok: true, snapshot: getDomSnapshot(message.options) };

        case 'GET_ACCESSIBILITY_TREE':
          return { ok: true, tree: getAccessibilityTree(message.maxDepth) };

        case 'APPLY_SET_OF_MARKS': {
          const markMap = applySetOfMarks();
          return {
            ok: true,
            count: markMap.size,
            marks: Object.fromEntries(
              Array.from(markMap.entries()).map(([k, el]) => [k, describeElement(el)]),
            ),
          };
        }

        case 'CLEAR_SET_OF_MARKS':
          clearSetOfMarks();
          return { ok: true };

        case 'CLICK_ELEMENT':
          return { ok: true, element: await clickElement(message.target, message.options) };

        case 'TYPE_IN_ELEMENT':
          return { ok: true, element: await typeInElement(message.target, message.text, message.options) };

        case 'SCROLL':
          return { ok: true, position: await scrollPage(message.options) };

        case 'FILL_FORM':
          return { ok: true, results: await fillForm(message.fields) };

        case 'GET_PAGE_INFO':
          return {
            ok: true,
            url:     location.href,
            title:   document.title,
            readyState: document.readyState,
            viewport: { w: window.innerWidth, h: window.innerHeight },
            scroll:  { x: window.scrollX, y: window.scrollY },
          };

        case 'FIND_ELEMENTS': {
          const els = message.selector
            ? Array.from(document.querySelectorAll(message.selector))
            : getInteractiveElements();
          return {
            ok: true,
            elements: els.slice(0, message.limit ?? 100).map(describeElement),
          };
        }

        case 'WAIT_FOR_SELECTOR': {
          const found = await waitForSelector(message.selector, message.timeout);
          return { ok: found, timedOut: !found };
        }

        default:
          return { ok: false, error: `Unknown message type: ${message.type}` };
      }
    };

    handle()
      .then(sendResponse)
      .catch(err => {
        log('error', 'Handler error:', err);
        sendResponse({ ok: false, error: err.message });
      });

    return true; // keep channel open
  });

  // ── waitForSelector ───────────────────────────────────────────────────────────

  function waitForSelector(selector, timeout = 5000) {
    return new Promise(resolve => {
      if (document.querySelector(selector)) { resolve(true); return; }
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) {
          observer.disconnect();
          resolve(true);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(false); }, timeout);
    });
  }

  // ── Anti-webdriver detection ──────────────────────────────────────────────────

  (function applyStealthPatches() {
    try {
      // Mask navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
    } catch (_) { /* already defined non-configurable */ }

    try {
      // Ensure plugins array looks non-empty (some sites check this).
      // Note: this is a minimal mock; sophisticated fingerprinting scripts may
      // still detect the extension. A complete PluginArray emulation is beyond
      // the scope of this stealth pass.
      if (navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
          get: () => ({ length: 3, item: () => null, namedItem: () => null }),
          configurable: true,
        });
      }
    } catch (_) { /* ignore */ }
  })();

  log('info', 'Content script initialised on', location.href);
})();
