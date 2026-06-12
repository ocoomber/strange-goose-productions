# CLAUDE.md — strange-goose-productions repo

Website for Strange Goose Productions. Static HTML/CSS, no build step, no dependencies. Hosted on GitHub Pages at strangegoose.co.uk. Pushing to main makes it live.

> **Client Portal:** There is an authenticated client portal in `client/`,
> `admin/`, `site/portal.*` and `supabase/`, backed by Supabase. If working on
> it, **read `PORTAL_NOTES.md` first** (architecture, live state, decisions,
> what's done/pending) and `admin/SETUP.md` (Supabase/Resend setup).

---

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Homepage |
| `about.html` | About SGP and the team |
| `work.html` | Portfolio / project showcase |
| `services.html` | Services offered |
| `contact.html` | Contact page |
| `ai.html` | AI production work — not in main nav, linked from homepage hero |

---

## Structure

- **`site/styles.css`** — shared stylesheet used by all pages
- **`img/`** — all images (portfolio stills, headshots, AI page images). All in one folder, no subfolders.
- **`testing/`** — a full clone of the live site for previewing redesigns. Mirrors the root structure exactly: `testing/site/styles.css` and `testing/img/`. See Testing Workflow.
- **`CNAME`** — GitHub Pages custom domain config, do not edit

No shared header or footer components. Each page is fully self-contained HTML.

---

## Design System

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

## Video Embeds

Videos use a click-to-play pattern — thumbnail shown first, iframe loads on click with autoplay. This keeps YouTube UI hidden until the user chooses to play. Each clickable element carries a `data-yt="VIDEO_ID"` attribute.

- Thumbnails pulled from `https://i.ytimg.com/vi/VIDEO_ID/maxresdefault.jpg` — update the thumbnail on YouTube and it updates on the site automatically.
- **`work.html`** uses the film-reel redesign: a horizontal strip of frames (GSAP + ScrollTrigger, loaded from a CDN) that open into a lightbox modal player (`.reel-lb`). Clicking a `.reel-frame[data-yt]` loads the iframe into the modal.
- **`index.html`** homepage reel has its own equivalent inline script for its single embed.

---

## Email Links

All email links must be plain `mailto:info@strangegoose.co.uk`. Do not use Cloudflare email obfuscation (`/cdn-cgi/l/email-protection`) — it only works behind Cloudflare and breaks on GitHub Pages. If you see `[email protected]` on the live site, a page with CF-encoded links has been pushed from an old local copy.

---

## Deployment

Owen syncs to GitHub via GitHub Desktop. Pushing to `main` deploys to strangegoose.co.uk via GitHub Pages. No CI, no build process.

**Important:** Owen sometimes pushes pages directly from his local machine. If a push is rejected because the remote is ahead, always `git pull --rebase origin main` before pushing. Never force push.

---

## Testing Workflow

There are two ways to test, depending on scale.

### `testing/` folder — for redesigns and multi-page work

`testing/` is a complete clone of the live site, served at **strangegoose.co.uk/testing/**. Owen can test it on his PC and phone exactly as it will look live. The folder mirrors the root structure (`testing/site/styles.css`, `testing/img/`), so **testing pages use the same relative paths as live** (`site/styles.css`, `img/...`) — no path rewriting between the two.

**Workflow:**
1. Build the redesign inside `testing/` (or Owen pushes new versions there himself).
2. Owen reviews at strangegoose.co.uk/testing/ on his devices.
3. Once approved, **promote to live**: straight-copy the changed `testing/` files to root (no path changes needed, structure mirrors). Then push to `main`.
4. **Re-sync `testing/` to match live** at the same time, so it stays a clean baseline for the next redesign. (Same straight copy in reverse.)

**Promotion checklist — always run before pushing to main:**
- **Email obfuscation:** grep the promoted files for `cdn-cgi`, `__cf_email__`, `email-decode` and any malformed `mailto:`. Replace with plain `mailto:info@strangegoose.co.uk`. Cloudflare encoding sneaks in when Owen saves pages from a CF-proxied copy.
- **Image paths:** every local `src`/`href` must be `img/filename` — watch for bare filenames missing the `img/` prefix (e.g. `src="owen.jpg"` should be `src="img/owen.jpg"`).
- **Stylesheet path:** every page links `site/styles.css`.
- After pushing, confirm the live page loads and `testing/` still works.

### Single test file — for quick one-page checks

For a small UI tweak on one page: create a named test file in `main` (e.g. `work-test.html`), let Owen test it at strangegoose.co.uk/work-test.html, then apply the change to the real file and delete the test file in a single commit. Avoids spinning up a branch.

---

## Feature Flags

Feature flags in `index.html` are inline `<script>` tags immediately after the relevant element. To toggle, set the variable to `true` or `false` and push to main.

| Flag | Variable | Location | Current state |
|------|----------|----------|---------------|
| AI consultancy aside | `AI_CONSULTANCY` | `index.html` after `.ai-aside` | off |

To turn a section on or off, just say "turn on/off the [name] section."

---

## Conventions

- Plain HTML5, no frameworks, no templating
- CSS variables for all colours and fonts — never hardcode hex values into page-level styles when a variable exists
- All images in `img/` with hyphenated filenames (no spaces)
- All pages link to `site/styles.css` with a relative path
