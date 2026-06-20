# CLAUDE.md — strange-goose-productions repo

Website for Strange Goose Productions. Static HTML/CSS, no build step, no dependencies. Hosted on GitHub Pages at strangegoose.co.uk. Pushing to main makes it live.

> **Start of session:** First, read `Claude To-Do List.txt` in the repo root —
> Owen edits it before a session as an opening brief of what to work on. It's a
> local, personal file (not always present in a fresh clone); if it's missing,
> just carry on.

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

For a UI tweak on one page: create a named test file in `main` (e.g. `work-test.html`), let Owen test it at strangegoose.co.uk/work-test.html, then apply the change to the real file and **delete the test file in the same commit**. Avoids spinning up a branch. Don't leave standalone preview/redesign files lying around once they've served their purpose.

**Pre-push checklist — always run before pushing changed pages to main:**
- **Email obfuscation:** grep changed files for `cdn-cgi`, `__cf_email__`, `email-decode` and any malformed `mailto:`. Replace with plain `mailto:info@strangegoose.co.uk`. Cloudflare encoding sneaks in when Owen saves pages from a CF-proxied copy.
- **Image paths:** every local `src`/`href` must be `img/filename` — watch for bare filenames missing the `img/` prefix (e.g. `src="owen.jpg"` should be `src="img/owen.jpg"`).
- **Stylesheet path:** every page links `site/styles.css`.
- After pushing, confirm the live page loads.

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
