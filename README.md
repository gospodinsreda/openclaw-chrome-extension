# OpenClaw Chrome Extension

**Advanced browser automation for AI assistants.** Real-time DOM analysis, accessibility tree rendering, Set-of-Mark element navigation, and stealth mode interaction.

---

## Features

| Feature | Details |
|---|---|
| **Complete Browser Control** | DOM manipulation, element navigation, screenshot capture, file downloads |
| **Real-time DOM Analysis** | Lightweight DOM snapshot with visibility filtering |
| **Accessibility Tree** | Full WAI-ARIA–aware tree rendering for semantic understanding |
| **Set-of-Mark (SoM)** | Visual element numbering overlaid on page for 99%+ click accuracy |
| **Stealth Mode** | Human-like delays, anti-webdriver detection, jittered mouse events |
| **Minimal Memory Footprint** | <15 MB; no heavy framework dependencies |
| **JavaScript Evaluation** | Execute arbitrary JS in both extension and page (MAIN) worlds |
| **Form Automation** | Typed input, checkbox toggling, select options via a simple API |
| **AI / LLM Integration** | Message-passing API designed for AI agent consumption |
| **Content Security Policy** | Strict extension-page CSP; no inline scripts |
| **Error Handling** | Structured `{ ok, error }` responses on every message |
| **Logging** | Per-level console logging in background, content script, and popup |

---

## Architecture

```
manifest.json          ← Manifest V3 declaration
background.js          ← Service Worker: screenshot, downloads, tab management, routing
content.js             ← Content Script: DOM analysis, SoM, interaction, stealth patches
inject.js              ← Injected into MAIN world: JS eval, storage access
popup.html / popup.js  ← Extension popup UI
icons/                 ← 16×16, 48×48, 128×128 PNG icons
```

### Message Flow

```
Popup / AI Agent
     │
     ▼ chrome.runtime.sendMessage
Background (background.js)
     │
     ▼ chrome.tabs.sendMessage  (or chrome.scripting.executeScript)
Content Script (content.js)  ←→  Page DOM
                     │
                     ▼ chrome.scripting (world: MAIN)
               inject.js  ←→  Page JS globals / localStorage
```

---

## Installation

### Load Unpacked (Development)

1. Clone or download this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the repository folder.
5. The OpenClaw icon appears in the toolbar.

### Supported Browsers

- Google Chrome 120+ (Manifest V3)
- Microsoft Edge 120+

---

## Usage

### Popup UI

Click the OpenClaw toolbar icon to open the popup. Four tabs are available:

| Tab | Purpose |
|---|---|
| **Control** | Take screenshots, apply/clear Set-of-Mark labels |
| **DOM** | Fetch DOM snapshot, accessibility tree, page info, element finder |
| **Eval** | Execute JavaScript in the extension context or the page world |
| **Logs** | View timestamped action log; clear with one click |

---

## API Reference

All communication uses `chrome.runtime.sendMessage` (background) or
`chrome.tabs.sendMessage` (content script). Every response has the shape:

```json
{ "ok": true,  "…": "…" }
{ "ok": false, "error": "message" }
```

### Background Messages (`chrome.runtime.sendMessage`)

#### `CAPTURE_SCREENSHOT`
```json
{ "type": "CAPTURE_SCREENSHOT", "tabId": 123, "format": "png", "quality": 90 }
```
Returns `{ ok, dataUrl, tabId, url }`.

#### `DOWNLOAD_FILE`
```json
{ "type": "DOWNLOAD_FILE", "url": "https://…", "filename": "file.pdf" }
```
Returns `{ ok, downloadId }`.

#### `NAVIGATE`
```json
{ "type": "NAVIGATE", "url": "https://…", "newTab": false }
```
Returns `{ ok, tabId }`.

#### `EVALUATE_SCRIPT`
```json
{ "type": "EVALUATE_SCRIPT", "code": "return document.title", "world": "MAIN" }
```
Returns `{ ok, result }`.

#### `GET_TABS`
Returns `{ ok, tabs: [{ id, url, title, active, status }] }`.

#### `RELAY_TO_CONTENT`
```json
{ "type": "RELAY_TO_CONTENT", "tabId": 123, "payload": { "type": "PING" } }
```
Proxies `payload` to the content script of the given tab.

---

### Content Script Messages (`chrome.tabs.sendMessage`)

#### `PING`
Returns `{ ok, url, title }`.

#### `GET_DOM_SNAPSHOT`
```json
{ "type": "GET_DOM_SNAPSHOT", "options": { "maxElements": 500 } }
```
Returns a JSON snapshot with `url`, `title`, `elementCount`, and an `elements` array.

Each element descriptor:
```json
{
  "tag": "BUTTON",
  "id": "submit-btn",
  "classes": ["btn", "primary"],
  "role": "button",
  "label": "Submit",
  "mark": "7",
  "value": null,
  "visible": true,
  "rect": { "x": 120, "y": 340, "w": 80, "h": 36 }
}
```

#### `GET_ACCESSIBILITY_TREE`
```json
{ "type": "GET_ACCESSIBILITY_TREE", "maxDepth": 8 }
```
Returns a nested WAI-ARIA tree.

#### `APPLY_SET_OF_MARKS`
Applies numbered blue overlay labels to all visible interactive elements.
Returns `{ ok, count, marks: { "1": elementDescriptor, … } }`.

#### `CLEAR_SET_OF_MARKS`
Removes all mark labels from the page.

#### `CLICK_ELEMENT`
```json
{
  "type": "CLICK_ELEMENT",
  "target": { "mark": "7" },
  "options": { "rightClick": false }
}
```
`target` can be `{ mark }`, `{ selector }`, or `{ xpath }`.

#### `TYPE_IN_ELEMENT`
```json
{
  "type": "TYPE_IN_ELEMENT",
  "target": { "selector": "#search" },
  "text": "hello world",
  "options": { "clearFirst": true, "humanDelay": true }
}
```

#### `SCROLL`
```json
{ "type": "SCROLL", "options": { "y": 400, "behavior": "smooth" } }
```

#### `FILL_FORM`
```json
{
  "type": "FILL_FORM",
  "fields": [
    { "target": { "selector": "#name" }, "value": "Alice" },
    { "target": { "selector": "#agree" }, "value": true }
  ]
}
```

#### `FIND_ELEMENTS`
```json
{ "type": "FIND_ELEMENTS", "selector": "a[href]", "limit": 50 }
```

#### `WAIT_FOR_SELECTOR`
```json
{ "type": "WAIT_FOR_SELECTOR", "selector": ".modal", "timeout": 5000 }
```
Returns `{ ok, timedOut }`.

---

## AI Agent Integration

OpenClaw is designed as a stateless command/response bus that any AI agent can
drive over the Chrome extension messaging API or via a local native-messaging
bridge. A typical agent loop:

```python
# Pseudocode – real implementation uses native messaging or DevTools protocol bridge
async def agent_loop(page_url):
    await send_bg({ "type": "NAVIGATE", "url": page_url })
    marks = await send_cs({ "type": "APPLY_SET_OF_MARKS" })
    screenshot = await send_bg({ "type": "CAPTURE_SCREENSHOT" })

    # Pass screenshot + marks to LLM
    llm_action = llm.decide(screenshot["dataUrl"], marks["marks"])

    if llm_action["type"] == "click":
        await send_cs({ "type": "CLICK_ELEMENT", "target": { "mark": llm_action["mark"] } })
    elif llm_action["type"] == "type":
        await send_cs({ "type": "TYPE_IN_ELEMENT",
                        "target": { "mark": llm_action["mark"] },
                        "text": llm_action["text"] })
```

---

## Security

- **No remote code execution** – all JS evaluation is triggered explicitly by the user or agent.
- **Strict CSP** – extension pages use `script-src 'self'`; no `eval` or inline scripts in extension pages.
- **Minimal permissions** – only `activeTab`, `scripting`, `downloads`, `storage`, `tabs`, and `debugger`.
- The `inject.js` `evaluate()` helper runs in the page world (not the extension world) and is isolated from extension privileges.

---

## License

MIT – see [LICENSE](LICENSE).
