# SGP MCP Data Source — Spreadsheet Design

**Status:** Stage one (design). The live spreadsheet is not built yet.
**Purpose:** Define the single source of truth a future SGP MCP server will read.

---

## 1. What this is for

SGP is building an **MCP (Model Context Protocol) server** that represents the
company to visiting AI agents — for example, an advertising exec sending their
AI PA to scout production companies. The agent hits the server and can have a
genuine, live conversation:

> *"Who are SGP? What have they made? What have they won? Can they make my
> advert, and how do I get in touch?"*

The server reads its answers from a **Google Sheet that Owen maintains**. When
he makes a new film he adds a row, and the agent's answers stay current with no
code changes. This document designs that sheet.

**We are not building the MCP server in this stage.** Stage one is getting the
data structure right.

---

## 2. Audit — what exists today

Owen has three relevant files in Drive:

| File | What it is | Verdict |
|------|-----------|---------|
| `SGP_Film_Catalogue` (Google Sheet) | A Dashboard plus **one tab per film**, with a per-film details block, budget breakdown, crew, and festivals. Reads from **fixed row positions**. | Built for human eyes. Fragile to read by API, mixes sensitive data in. **Don't reuse.** |
| `SGP_48hr_Nominations_Awards` (Google Sheet) | A flat awards log (`City, Year, Film, Category, Result`) — **48-hour films only**. | Missing all festival awards (e.g. Fairytale Farm's wins). Incomplete. **Superseded.** |
| **`SGP_Catalogue.xlsx`** (created 11 Jun 2026) | Two clean flat tables: **Films** and **Awards**. | **Newest, most complete, already machine-shaped. This is the foundation for the new design.** |

### Why `SGP_Catalogue.xlsx` wins
- **12 productions** (includes *Unravelling*, 2026) vs 11 in the old catalogue.
- **Complete award record** — festival wins + official selections + 48hr
  results all in one place (the standalone 48hr sheet had none of the festival
  data).
- **Canonical names** (`Roadtrippin'` with the apostrophe), fully-named events
  with countries, and richer notes ("Most-decorated SGP film", "Screened at
  Filmapalooza 2026, Lisbon").

Confirmed headline figures from the xlsx: **12 productions · 17 wins ·
~11 official selections.** (The old "16 wins" predated *Unravelling*'s win.)

### Problems the new design must fix
1. **Award data was split and contradictory** across the two Google Sheets.
2. **Fixed-row, per-tab layout** is fragile for an API to parse.
3. **Ambiguous values** — runtime `07:00` under a header labelled "(mins)";
   freeform genres (`Other`, `Time travel`, `Roadtrip`, `Music Video`).
4. **Sensitive data mixed in** — budgets, crew contacts, pay status sat
   alongside public info.
5. **No company narrative at all** — bio, services, team, contact. This is the
   *first* thing an exec's PA asks, and it only existed on the website.

---

## 3. Design decisions (agreed with Owen)

1. **New dedicated file** for this project — don't reuse the legacy sheets.
2. **Flat tables + a derived dashboard** — clean for the machine, with a nice
   human overview.
3. **Company narrative lives in the sheet** — so Owen controls the agent's
   answers without touching code.
4. **The whole file is agent-facing** — it carries public-safe data only.
   Budgets and crew contact details are deliberately excluded.

---

## 4. The design — `SGP_AI_Profile` (new Google Sheet)

One Google Sheet, ten tabs. Eight are data the MCP reads (`Company`, `Films`,
`Awards`, `Team`, `Services`, `Capabilities`, `Press`, `FAQ`); one is a human
dashboard; one is instructions for Owen.

### Machine-reading rules (apply to every data tab)
- **Row 1 = stable `snake_case` column keys.** Never rename or reorder them —
  the MCP maps by these keys.
- **One record per row.** No merged cells, no stacked headers, no blank spacer
  rows inside a table.
- **Controlled vocabularies** for every enum column (defined below). Stick to
  the exact allowed values.
- **`film_id`** (a lowercase hyphenated slug) is the **canonical join key**
  linking `Films` ↔ `Awards`. This permanently fixes the `Roadtrippin` vs
  `Roadtrippin'` mismatch — names can vary, the id never does.
- Years are plain numbers; runtime is stored as `mm:ss` (see `Films`).

---

### Tab 1 — `Company`
A key–value singleton: the facts an agent wants first. **Two columns.**

| Column | Notes |
|--------|-------|
| `field` | The fact's machine key (snake_case). |
| `value` | The value Owen writes. |

Rows to include:

| `field` | Example `value` |
|---------|-----------------|
| `trading_name` | Strange Goose Productions |
| `founded_year` | 2024 |
| `based_in` | Scotland, UK |
| `one_line_pitch` | Award-winning Scottish production company making festival shorts and fast-turnaround films. |
| `short_bio` | 2–3 sentences. |
| `long_bio` | A fuller paragraph. |
| `approach` | The story — multi-award-winning films made on micro-budgets, fast turnarounds, 48-hour competition pedigree. *(This is where the budget angle lives, narratively, instead of per-film figures.)* |
| `specialisms` | Short films, 48-hour competition films, music videos, narrative + horror. |
| `available_for_hire` | yes |
| `website` | https://strangegoose.co.uk |
| `showreel_url` | (YouTube link) |
| `contact_email` | info@strangegoose.co.uk |
| `youtube` | (channel URL) |
| `instagram` | (profile URL) |
| `total_productions` | 12 *(can mirror Dashboard)* |
| `total_wins` | 17 |
| `total_nominations` | (count) |
| `official_selections` | 11 |
| `countries_screened` | UK, USA, Italy, Portugal |

**Industry / producer fields** (a commissioning producer vets a company on
these — fill in what applies, leave the rest blank):

| `field` | Example `value` |
|---------|-----------------|
| `business_type` | Sole trader / Ltd company |
| `company_number` | Companies House number, if registered |
| `vat_registered` | yes/no |
| `insurance` | e.g. Public liability + equipment insured (yes/no/details) — producers ask before contracting |
| `years_active` | derived from `founded_year` |
| `service_area` | where SGP shoots / how far they'll travel, e.g. Scotland + UK-wide, will travel |
| `languages` | English |
| `crew_size` | typical crew available for a commission |
| `typical_turnaround` | e.g. 48 hours (competition) to ~4 weeks (commissioned) |
| `budget_range` | the band of project budgets SGP works within — optional; leave blank if you'd rather discuss per-brief |
| `notable_clients` | brands / artists / partners worked with |
| `representation` | agent / rep, if any |
| `press_kit_url` | EPK / press kit link |

> Headline stats can be hand-entered or pulled from `Dashboard` via formula —
> see Tab 7.

---

### Tab 2 — `Films`
One row per production. Based on the xlsx `Films` tab, plus a logline and
synopsis (the things an agent actually wants to relay).

| Column | Type / vocab |
|--------|--------------|
| `film_id` | slug, e.g. `family-time`, `roadtrippin`. **Join key.** |
| `title` | display title, e.g. `Roadtrippin'` |
| `type` | enum: `48 Hour Film` · `Short Film` · `Music Video` · `Feature` · `Commercial` |
| `status` | enum: `In Development` · `In Production` · `Unreleased` · `Completed` · `Festival Run` |
| `year` | number |
| `competition` | e.g. `48 Hour Film Project — Edinburgh 2024`; blank for non-competition films |
| `genre` | enum (controlled): `Drama` · `Thriller` · `Sci-Fi` · `Horror` · `Psychological Horror` · `Dark Comedy` · `Comedy` · `Romance` · `Music Video` · `Other` |
| `logline` | **new** — one sentence |
| `synopsis` | **new** — short paragraph |
| `runtime` | `mm:ss`, e.g. `07:00` |
| `director` | name |
| `producer` | name |
| `dp` | name |
| `youtube_url` | link |
| `imdb_url` | link |
| `poster_url` | link |
| `stills_url` | link |
| `featured` | yes/no — lets the agent lead with the best work |
| `notes` | freeform context |

**Industry / producer fields** (the credits, specs and rights a producer,
distributor or programmer asks about — fill what you can, blanks are fine):

| Column | Type / vocab |
|--------|--------------|
| `writer` | name(s) |
| `lead_cast` | principal cast, comma-separated |
| `editor` | name |
| `composer` | name / music credit |
| `commissioned_by` | client / artist for commissioned work, e.g. music-video artist or brand; blank for own productions |
| `language` | spoken language, e.g. English |
| `runtime_seconds` | machine-friendly duration (e.g. `420`) — removes the `mm:ss` ambiguity for sorting/filtering |
| `aspect_ratio` | e.g. `16:9`, `2.39:1` |
| `resolution` | e.g. `4K`, `1080p` |
| `shoot_format` | camera / format, e.g. `Digital — Sony FX3` |
| `shoot_location` | where it was filmed |
| `themes` | tags for brief-matching, e.g. `grief, family, dark comedy` — lets an agent match SGP's work to a brief |
| `content_rating` | age guidance / advisory, e.g. `15`, `Contains horror` |
| `release_date` | ISO date, if released |
| `trailer_url` | link, if separate from the full film |
| `rights_holder` | who owns it, e.g. `Strange Goose Productions` |
| `licensing_available` | yes/no — can it be licensed / screened / acquired |
| `press_kit_url` | per-film EPK, if any |

**Migrate all 12 films** from the xlsx: Dream House, Creag, Subject 1410,
Fairytale Farm, The Science of Grief, The Journeyman, Roadtrippin', Crossfire,
Family Time, Where Ball?, Getting Over Going Under, Unravelling.

Normalise the freeform genres from the old data (`Time travel` → `Sci-Fi`,
`Roadtrip` → `Other`/`Comedy` as appropriate, etc.) when migrating.

**Budget is deliberately omitted** (visibility decision). The micro-budget
story lives in `Company.approach`.

---

### Tab 3 — `Awards`
One row per result. Based directly on the xlsx `Awards` tab — already the right
shape, just add the `film_id` join key.

| Column | Type / vocab |
|--------|--------------|
| `film_id` | slug — **must match a `Films.film_id`** |
| `film_title` | display title (human-readable mirror) |
| `year` | number |
| `result` | enum: `Win` · `Nomination` · `Official Selection` |
| `category` | e.g. `Best Use of Genre`; blank for plain selections |
| `event` | full event name, e.g. `48hr Film Project — Aberdeen`, `Monza Film Fest` |
| `country` | `UK` · `USA` · `Italy` · `Portugal` … |

**Industry / producer fields:**

| Column | Type / vocab |
|--------|--------------|
| `event_date` | ISO month/date, e.g. `2025-10` — lets the agent give a timeline |
| `qualifying` | enum/blank: `Academy-qualifying` · `BAFTA-qualifying` · `Oscar & BAFTA-qualifying` — leave blank if not. **Programmers and producers weight qualifying festivals heavily.** |
| `event_url` | festival / event website |

**Migrate the full xlsx Awards list** — this is the complete record (festival
wins, official selections, and all 48hr results). It's the source that makes
the headline counts (17 wins, ~11 official selections) add up.

---

### Tab 4 — `Team`
One row per person. **Public-safe only** — no contact details, no pay status.

| Column | Notes |
|--------|-------|
| `name` | e.g. Owen Coomber |
| `roles` | e.g. `Director / Camera` |
| `short_bio` | one or two sentences |
| `notable_credits` | key films |
| `based_in` | location |
| `languages` | e.g. English |
| `imdb_url` | IMDb profile |
| `web_url` | website / portfolio |
| `showreel_url` | personal reel, if any |
| `headshot_url` | image link |

---

### Tab 5 — `Services`
One row per offering — answers "what can SGP do for me?" for a commissioning
agent.

| Column | Notes |
|--------|-------|
| `service` | e.g. `Short-form narrative`, `Music videos`, `Brand / commercial films` |
| `description` | what it covers |
| `good_for` | the kind of client/brief it suits |
| `deliverables` | what the client gets, e.g. `4K master, social cut-downs` |
| `formats` | e.g. `16:9, 9:16 vertical, square` |
| `typical_turnaround` | lead time for this service |
| `rate_basis` | how it's priced, e.g. `Project / day rate — POA` — leave blank to keep rates to direct enquiry |

---

### Tab 6 — `Capabilities` *(new)*
One row per in-house capability or kit item — answers a producer's "can you
self-deliver, or will you be subcontracting?" Owen can leave this thin early on.

| Column | Notes |
|--------|-------|
| `category` | enum: `Camera` · `Lighting` · `Sound` · `Editing` · `Colour` · `VFX` · `Grip` · `Other` |
| `detail` | what's owned / available, e.g. `Sony FX3 + prime set` |
| `in_house` | yes/no — owned/in-house vs hired-in for the job |

---

### Tab 7 — `Press` *(new)*
One row per review, quote, or coverage — social proof a producer's AI looks for.

| Column | Notes |
|--------|-------|
| `source` | publication / festival / person |
| `quote` | the pull-quote or review line |
| `film` | related film title, if any |
| `url` | link to the piece |
| `date` | ISO date |

---

### Tab 8 — `FAQ`
One row per question. Lets Owen **script the agent's answers** to common
questions directly, with no code change.

| Column | Notes |
|--------|-------|
| `question` | e.g. "Do you take commissioned/brand work?" |
| `answer` | Owen's exact answer |

Seed questions: work-for-hire? typical turnaround? where are you based? who
owns the rights? how do I get a quote?

---

### Tab 9 — `Dashboard` (read-only, formula-driven)
A human overview and a quick summary read for the MCP. Every figure is derived
so it never drifts:

- `total_productions` = `=COUNTA(Films.film_id)` (minus header)
- `total_wins` = `=COUNTIF(Awards.result, "Win")`
- `total_nominations` = `=COUNTIF(Awards.result, "Nomination")`
- `official_selections` = `=COUNTIF(Awards.result, "Official Selection")`
- `festivals` = `=COUNTUNIQUE(Awards.event)`
- `qualifying_selections` = `=COUNTIF(Awards.qualifying, "<>")` (count of Academy/BAFTA-qualifying results)
- `countries_screened` = `=COUNTUNIQUE(Awards.country)`

---

### Tab 10 — `README` (instructions for Owen)
The maintenance contract, in the sheet itself:
- **To add a film:** add one row to `Films` with a new `film_id`, then add its
  result rows to `Awards` using that **same `film_id`**.
- The controlled-vocabulary lists for `type`, `status`, `genre`, `result`,
  `qualifying`, and `Capabilities.category`.
- **Never rename or reorder the row-1 headers** — the MCP reads by those keys.
- Keep `film_id` lowercase-hyphenated and unique.
- Industry fields can be left blank — the MCP just won't volunteer what isn't
  filled in.

---

## 5. How the design maps to the agent's questions

| Agent asks… | Reads from |
|-------------|-----------|
| Who are SGP? | `Company`, `Team` |
| What have they made? | `Films` (+ `logline`/`synopsis`/`themes`) |
| What have they won? | `Awards` (+ `qualifying`), `Dashboard` |
| Can they do *my* project? | `Services`, `Capabilities`, `FAQ`, `Company.available_for_hire` |
| Can they self-deliver / what kit? | `Capabilities` |
| Are they legit / low-risk? | `Company` (`business_type`, `insurance`, `years_active`), `Press` |
| Who's on the team? | `Team` |
| Can I license / screen a film? | `Films.licensing_available`, `Films.rights_holder` |
| How do I get in touch? | `Company.contact_email`, `website`, socials |

---

## 6. Next steps (later stages, not this one)

1. **Build the live `SGP_AI_Profile` Google Sheet** to this schema and migrate
   all 12 films + the full awards list (can be done via the Drive tools).
2. Owen fills in the new narrative fields (loglines, synopses, company bio,
   services, FAQ).
3. Build the MCP server to read the sheet.
4. Retire / redirect the three legacy spreadsheets so there's one source of
   truth.
