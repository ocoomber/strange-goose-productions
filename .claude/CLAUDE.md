# CLAUDE.md — strange-goose-productions repo

Website for Strange Goose Productions. Static HTML/CSS, no build step, no dependencies. Hosted on GitHub Pages at strangegoose.co.uk. Pushing to main makes it live.

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

All videos use a poster/click-to-play pattern — thumbnail shown first, iframe loads on click with autoplay. This keeps YouTube UI hidden until the user chooses to play.

- Thumbnails pulled from `https://i.ytimg.com/vi/VIDEO_ID/maxresdefault.jpg` — update the thumbnail on YouTube and it updates on the site automatically.
- The click handler in `work.html` handles all `.player[data-yt]` elements.
- The homepage reel (`index.html`) has its own equivalent inline script.

---

## Email Links

All email links must be plain `mailto:info@strangegoose.co.uk`. Do not use Cloudflare email obfuscation (`/cdn-cgi/l/email-protection`) — it only works behind Cloudflare and breaks on GitHub Pages. If you see `[email protected]` on the live site, a page with CF-encoded links has been pushed from an old local copy.

---

## Deployment

Owen syncs to GitHub via GitHub Desktop. Pushing to `main` deploys to strangegoose.co.uk via GitHub Pages. No CI, no build process.

**Important:** Owen sometimes pushes pages directly from his local machine. If a push is rejected because the remote is ahead, always `git pull --rebase origin main` before pushing. Never force push.

---

## Testing Workflow

For UI changes that need real device testing (mobile layout, video embeds etc): create a named test file in `main` (e.g. `work-test.html`), let Owen test it at strangegoose.co.uk/work-test.html on his phone or desktop, then apply the change to the real file and delete the test file in a single commit. This avoids spinning up a branch for small UI tests.

---

## Conventions

- Plain HTML5, no frameworks, no templating
- CSS variables for all colours and fonts — never hardcode hex values into page-level styles when a variable exists
- All images in `img/` with hyphenated filenames (no spaces)
- All pages link to `site/styles.css` with a relative path
