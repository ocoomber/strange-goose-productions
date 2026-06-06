# CLAUDE.md — strange-goose-productions repo

Website for Strange Goose Productions. Static HTML/CSS, no build step, no dependencies. Hosted on GitHub Pages at strangegoose.co.uk. Pushing to main makes it live.

---

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Homepage |
| `about.html` | About SGP and the team |
| `work.html` | Portfolio / project showcase |
| `commercial.html` | Commercial production work |
| `ai.html` | AI production work |
| `glossary.html` | Glossary page |
| `showreels.html` | Actor showreel services — **standalone, see below** |

---

## Structure

- **`site/styles.css`** — shared stylesheet used by all pages except `showreels.html`
- **`site/img/`** — shared images used by the main site
- **`uploads/`** — portfolio and production images (film stills, headshots etc)
- **`CNAME`** — GitHub Pages custom domain config, do not edit

No shared header or footer components. Each page is fully self-contained HTML.

---

## Design System (main site)

Warm, earthy palette. Fonts loaded from Google Fonts.

```css
--paper: #f5f2ec;      /* page background */
--paper-2: #ebe7dd;
--paper-3: #e3dfd3;
--ink: #14120f;        /* primary text */
--ink-2: #2a2622;
--ink-3: #5a5449;
--muted: #8a8376;
--faint: #c7c1b3;
--accent: oklch(58% 0.14 45);   /* warm amber/brown */

--sans: 'Inter Tight', system-ui, sans-serif;
--mono: 'JetBrains Mono', ui-monospace, monospace;
```

Max content width: `1280px` (`.wrap`), `960px` (`.wrap-tight`).

---

## showreels.html — Standalone Page

This page is completely separate from the rest of the site:

- **Does not use `site/styles.css`** — all styles are embedded in a `<style>` block in the `<head>`
- Different fonts: Newsreader (serif), Archivo, Hanken Grotesk
- The `<style>` block defines dark CSS variables as defaults — **these are overridden** by an inline `style` attribute on the `.page` div (line ~259) which applies the actual light theme (`--bg:#f4f1e8` etc)
- Do not remove or alter that inline style override — it is what makes the page light
- Accent colour on showreels is blue (`#5d80b0`), not amber

---

## Deployment

Owen syncs to GitHub via the GitHub desktop app. Pushing to `main` deploys to strangegoose.co.uk via GitHub Pages. No CI, no build process.

---

## Conventions

- Plain HTML5, no frameworks, no templating
- CSS variables for all colours and fonts — never hardcode hex values into page-level styles when a variable exists
- Images referenced from `uploads/` use relative paths
- All pages link to `site/styles.css` with a relative path (`site/styles.css`) except `showreels.html`
