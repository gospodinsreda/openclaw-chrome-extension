/**
 * OpenClaw Injected Script (inject.js)
 *
 * Runs in the MAIN world of the page (via chrome.scripting.executeScript with
 * world: 'MAIN') so it has full access to the page's JavaScript environment.
 *
 * Provides: safe JS evaluation, local storage access, and reading JS globals.
 */

(function openClawInject() {
  'use strict';

  // Expose a minimal API under a unique namespace
  if (window.__openClaw) return;

  window.__openClaw = {
    version: '1.0.0',

    /**
     * Safely evaluates an expression string in the page context.
     * Returns { ok, result } or { ok: false, error }.
     */
    evaluate(expression) {
      try {
        // eslint-disable-next-line no-eval
        const result = (0, eval)(expression);
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /** Returns all localStorage key-value pairs as a plain object. */
    getLocalStorage() {
      try {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          data[key] = localStorage.getItem(key);
        }
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /** Returns all sessionStorage key-value pairs as a plain object. */
    getSessionStorage() {
      try {
        const data = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          data[key] = sessionStorage.getItem(key);
        }
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /** Returns document.cookie as a parsed key-value object. */
    getCookies() {
      try {
        const data = {};
        document.cookie.split(';').forEach(pair => {
          const [k, ...rest] = pair.trim().split('=');
          if (k) {
            const raw = rest.join('=');
            let val = raw;
            try { val = decodeURIComponent(raw); } catch (_) { /* keep raw value */ }
            data[k.trim()] = val;
          }
        });
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
})();
