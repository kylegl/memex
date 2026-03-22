# Share Card v2 + Markdown Rendering Upgrade — Design Spec

## Background

Current share card uses Canvas 2D API to render plain text. Cannot handle tables, images, lists, or any rich markdown. The style picker is 4 color circles — too simple. The share code is tightly coupled inside serve-ui.html (1900+ lines).

## Goals

1. Full markdown rendering across all views (timeline, graph, share)
2. Share card with rich content (tables, images, code blocks)
3. Style picker with 6 visual themes shown as thumbnail previews
4. share-card.js as independent ES module, importable by other projects

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering | DOM + html2canvas | Full markdown support, CSS-based styling, ~40KB |
| Style picker UI | Thumbnail grid with skeleton previews | Matches flomo/yuque reference, intuitive |
| Reuse form | Single-file ES module | Lightest weight, easy to upgrade later |
| Architecture | Extract first, then upgrade | serve-ui.html already too large |
| Markdown lib | marked (CDN) | ~8KB gzip, mature, zero config |
| Built-in themes | 6 pure color + gradient, no image backgrounds | Zero asset dependency |

---

## 1. Markdown Rendering Upgrade

### Current State

`renderMarkdown()` in serve-ui.html uses regex, supports only: code blocks, inline code, bold, `[[links]]`.

### Target State

Replace with `marked.parse()` loaded via CDN. Add post-processing for `[[link]]` chips.

```js
// Load marked via CDN in serve-ui.html <head>
// <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

function renderMarkdown(text) {
  // Protect [[links]] from marked parsing
  const protected = text.replace(/\[\[([^\]]+)\]\]/g, '%%LINK:$1%%');
  let html = marked.parse(protected, { breaks: true });
  // Restore [[links]] as clickable chips
  html = html.replace(/%%LINK:(.+?)%%/g,
    '<span class="chip" data-link="$1">[[$1]]</span>');
  return html;
}
```

### Scope of Impact

- Timeline card body (expanded view)
- Graph view card panel
- Share card body
- All three share the same `renderMarkdown()` function

### CSS Additions

Add styles for elements marked now generates but didn't before:

- `table / th / td` — bordered, striped rows
- `img` — max-width: 100%, border-radius
- `ul / ol / li` — proper list styling
- `blockquote` — left border, muted color
- `h1-h6` — heading sizes within card body
- `hr` — divider line

---

## 2. share-card.js — Independent ES Module

### File Structure

```
src/
  share-card/
    share-card.js     ← main module: createShareCard(), themes included
```

Single file, zero dependencies. Themes are defined inline (6 themes don't justify a separate file). `html2canvas` is lazy-loaded from CDN on first export.

### Dual Usage

- **Standalone**: `import { createShareCard } from './share-card.js'` — works as ES module
- **Embedded in serve-ui.html**: the same code is wrapped in an IIFE and inlined into serve-ui.html inside a `<script>` block. A simple build script (`scripts/inline-share.sh`) copies the code and wraps it. Alternatively, manual copy during development.

The source of truth is `src/share-card/share-card.js`. serve-ui.html's inline copy is derived from it.

### Input Safety

All card data is local (written by the user or their AI agent). No untrusted user input. `marked.parse()` output is used as-is without DOMPurify — acceptable for a local CLI tool.

### API

```js
// createShareCard(container, options) → controller
const card = createShareCard(document.getElementById('root'), {
  data: {
    title: 'Card Title',
    body: '## Markdown\n\nFull **markdown** here...',
    created: '2026-03-20',
    source: 'retro',
    links: ['slug-a', 'slug-b'],
    stats: { totalCards: 42, totalDays: 7 },
  },
  theme: 'aurora',                    // default theme
  markdownRenderer: marked.parse,     // injected, not bundled
  onExport: (blob, filename) => {},   // export callback
});

// Controller methods
card.setTheme('ocean');
card.setData({ title: '...' });
card.export('png');   // html2canvas → blob → onExport
card.destroy();       // cleanup DOM
```

### Key Design Decisions

- **`markdownRenderer` is injected** — share-card.js has zero dependency on `marked`. Consumer passes in whatever renderer they want. This keeps the module pure.
- **html2canvas lazy-loaded** — not imported at module level. On first `export()` call, dynamically loads from CDN. If already loaded, skips.
- **Self-contained styles** — all CSS is injected via `<style>` element into the container, scoped with a unique class prefix `.memex-sc-*` to avoid leaking.
- **No Shadow DOM** — simpler, easier to debug, style scoping via class prefix is sufficient.

### DOM Structure (rendered by createShareCard)

```html
<div class="memex-sc-root" data-theme="aurora">
  <!-- Style picker: thumbnail grid -->
  <div class="memex-sc-picker">
    <div class="memex-sc-thumb active" data-theme="clean">
      <!-- skeleton preview mimicking card layout -->
    </div>
    <div class="memex-sc-thumb" data-theme="aurora">...</div>
    <!-- 6 thumbnails total -->
  </div>

  <!-- Card preview (what gets exported) -->
  <div class="memex-sc-card">
    <div class="memex-sc-header">
      <span class="memex-sc-source">RETRO</span>
      <span class="memex-sc-date">2026/03/20</span>
    </div>
    <div class="memex-sc-title">Card Title</div>
    <div class="memex-sc-body">
      <!-- rendered markdown HTML -->
    </div>
    <div class="memex-sc-links">
      <span class="memex-sc-chip">[[slug-a]]</span>
    </div>
    <div class="memex-sc-footer">
      <span class="memex-sc-stats">42 CARDS · 7 DAYS</span>
      <span class="memex-sc-brand">memex</span>
    </div>
  </div>

  <!-- Actions -->
  <div class="memex-sc-actions">
    <button class="memex-sc-btn secondary">Cancel</button>
    <button class="memex-sc-btn primary">Download</button>
  </div>
</div>
```

---

## 3. Themes

6 built-in themes, defined in `share-card.js`:

| Name | Background | Text | Accent | Description |
|------|-----------|------|--------|-------------|
| `clean` | `#ffffff` | `#1d1d1f` | `#007aff` | 纯白，干净 |
| `aurora` | radial-gradient (pink→cyan→white) | `#1d1d1f` | `#007aff` | 极光渐变，柔和 |
| `spectrum` | linear-gradient (purple→blue→cyan) | `#ffffff` | `#5ac8fa` | 彩色渐变，深色 |
| `ocean` | `#235ff5` | `#ffffff` | `#a0d4ff` | 深蓝纯色 |
| `ember` | `#fb7933` | `#ffffff` | `#ffd6b0` | 橙色纯色 |
| `frost` | `#e7f1fa` | `#1d1d1f` | `#007aff` | 浅蓝，冷淡 |

Each theme is a plain object:

```js
export const themes = {
  clean: {
    background: '#ffffff',
    text: '#1d1d1f',
    secondary: '#666666',
    accent: '#007aff',
    chipBg: 'rgba(0,122,255,0.08)',
    chipText: '#007aff',
    border: 'rgba(0,0,0,0.08)',
    brand: '#999999',
  },
  aurora: {
    background: 'radial-gradient(138% 32% at 70% 33%, #fff 2%, rgba(255,160,247,0.3) 50%, rgba(212,245,255,0.5)), #fff',
    // ...
  },
  // ...
};
```

Theme affects only the card background and color tokens. Body content (markdown) always renders on a semi-transparent white/dark content area for readability.

---

## 4. serve-ui.html Integration

### Changes

1. **Remove**: existing Canvas-based share renderer (~160 lines)
2. **Remove**: existing `renderMarkdown()` regex implementation
3. **Add**: `<script src="marked CDN">` in head
4. **Add**: new `renderMarkdown()` using `marked.parse()` + `[[link]]` post-processing
5. **Add**: share-card.js code inlined as IIFE in a `<script>` block (copied from src/share-card/share-card.js, wrapped in IIFE to avoid polluting global scope)
6. **Update**: share modal HTML — replace `<canvas>` with `<div id="shareRoot">`
7. **Update**: `shareCard()` function — instantiate `createShareCard()` instead of canvas drawing
8. **Update**: theme picker buttons → thumbnail grid
9. **Add**: CSS for markdown elements (table, img, blockquote, lists, headings)

### Share Flow (updated)

```
User clicks "Share" on expanded card
  → shareCard(slug) fetches card data
  → createShareCard(shareRoot, { data, theme, markdownRenderer })
  → User sees DOM-rendered preview with style picker
  → User picks theme via thumbnail grid
  → User clicks "Download"
  → card.export('png') → html2canvas → blob → download
```

---

## 5. Card Layout

Preserved from current design, with improved structure:

```
┌─────────────────────────────────────┐
│  [SOURCE badge]         2026/03/20  │  ← header
│                                     │
│  Card Title (bold, large)           │  ← title
│                                     │
│  Markdown body rendered with full   │  ← body (rendered markdown)
│  support: tables, images, code,     │
│  lists, blockquotes, etc.           │
│                                     │
│  [[link-a]] [[link-b]] [[link-c]]   │  ← link chips
│                                     │
│  ─────────────────────────────────  │  ← divider
│  42 CARDS · 7 DAYS          memex   │  ← footer
└─────────────────────────────────────┘
```

Width: 420px (export at 2x = 840px for retina).
Height: dynamic, based on content.

---

## Out of Scope

- Image background themes (require asset bundling)
- Custom background upload
- CLI `memex share` command (separate spec)
- Web Component / npm package publishing
- Syntax highlighting for code blocks (plain `<pre><code>` is sufficient)
