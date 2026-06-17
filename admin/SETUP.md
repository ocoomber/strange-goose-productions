# SGP Client Portal — one-time setup (Owen)

The portal is static HTML on the existing site. All data lives in a free
Supabase project. Follow these steps once.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → sign up (free tier is fine).
2. Create a **New project**. Name it `sgp-portal`, pick a strong database
   password (you won't need it day-to-day), region: West EU (London).

## 2. Run the schema

1. In the Supabase dashboard, open **SQL Editor**.
2. Paste the entire contents of `supabase/schema.sql` (in this repo) and **Run**.

## 3. Create your admin account

1. **Authentication → Users → Add user** — your email + a strong password.
   Tick "Auto confirm user".
2. Back in **SQL Editor**, run (with your email):

   ```sql
   update public.profiles
   set role = 'admin', must_change_password = false
   where email = 'info@strangegoose.co.uk';
   ```

## 4. Connect the website

1. **Project Settings → API** — copy the **Project URL** and the
   **anon / public** key.
2. Paste both into `site/portal.js` at the top (the two `PASTE_…` placeholders).
   The anon key is safe to publish — access control is enforced by the
   database's Row Level Security, not by hiding the key.
3. **Authentication → URL Configuration** — set Site URL to
   `https://www.strangegoose.co.uk` .
4. Push to `main`.

## 5. Edge Functions — emails + account creation (one-time)

These power email notifications, the admin "New client account" form, and
self-service password reset. All free tier.

### 5a. Resend (email sending)

1. Sign up at [resend.com](https://resend.com) (free tier: 100 emails/day).
2. **Domains → Add domain** — `strangegoose.co.uk`. Add the DNS records it
   shows you (at your domain registrar) and wait for "Verified".
3. **API Keys → Create** — copy the key (starts `re_`).

### 5b. Create the two Edge Functions

In the Supabase dashboard, **Edge Functions → Deploy a new function →
Via Editor**, twice. Each function is self-contained — paste the whole
file, no edits needed:

1. Function name **`notify`** — paste all of
   `supabase/functions/notify/index.ts`. Deploy.
2. Function name **`create-client`** — paste all of
   `supabase/functions/create-client/index.ts`. Deploy.
3. Function name **`manage-client`** — paste all of
   `supabase/functions/manage-client/index.ts`. Deploy.

(If you ever use the Supabase CLI instead, they deploy as-is:
`supabase functions deploy notify create-client manage-client`.)

### 5c. Secrets

**Edge Functions → Secrets** (or Project Settings → Edge Functions), add:

| Name | Value |
|------|-------|
| `RESEND_API_KEY` | the `re_…` key from 5a |
| `ADMIN_EMAIL` | your inbox, e.g. `info@strangegoose.co.uk` |
| `WEBHOOK_SECRET` | any long random string — generate one and keep it for 5d |

### 5d. Database Webhooks (what fires the notification emails)

**Database → Webhooks → Create a new hook**, twice:

1. Name `notify-approvals` · table `approvals` · events: **Insert** ·
   type: **Supabase Edge Function** → `notify` ·
   HTTP headers: add `x-webhook-secret` = your `WEBHOOK_SECRET` value.
2. Name `notify-stages` · table `stages` · events: **Update** ·
   same function + header. (The function ignores updates that aren't a
   stage being submitted to the client.)

### 5e. Password reset redirect

**Authentication → URL Configuration → Redirect URLs** — add:
`https://www.strangegoose.co.uk/client/`

## 5f. Google sign-in for clients (optional but recommended)

Lets a client skip the password and sign in with one Google click. You still
create every account yourself — Google is only an alternative way *in* to an
account you already provisioned. No random signups (see the toggle in step 3).

1. **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)):
   - Create (or pick) a project. **APIs & Services → OAuth consent screen** —
     External, app name "Strange Goose Productions Client Portal", your support
     email; save.
   - **APIs & Services → Credentials → Create credentials → OAuth client ID →
     Web application.** Under **Authorized redirect URIs** add exactly:
     `https://zawrkuclsdqtvftfothj.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client secret**.
2. **Supabase → Authentication → Providers → Google** — enable, paste the
   Client ID + secret, save.
3. **Supabase → Authentication → Sign In / Providers (or Providers → Email)** —
   turn **OFF** "Allow new users to sign up". This is what keeps strangers out:
   a Google login whose email you didn't pre-create is rejected, while your
   admin **New client account** form still works (it creates users directly).
4. **Supabase → Authentication → URL Configuration:**
   - **Site URL** = `https://strangegoose.co.uk` (the canonical **non-www**
     domain — what the live site settles on in the address bar).
   - **Redirect URLs** — list all four (covers www/non-www for both the portal
     and password reset, so OAuth can never fall back to the homepage):
     ```
     https://strangegoose.co.uk/client/
     https://www.strangegoose.co.uk/client/
     https://strangegoose.co.uk/**
     https://www.strangegoose.co.uk/**
     ```

   > **Gotcha (this bit the first setup):** if the redirect URL the portal
   > requests isn't in this list, Supabase silently falls back to the **Site
   > URL** and dumps the user on the homepage with the token stuck in the URL
   > (`strangegoose.co.uk/#access_token=…`) — login appears to "do nothing".
   > The wildcards above prevent it regardless of www/non-www.

**How it links up:** because accounts are created with a verified email
(`email_confirm: true`), Supabase automatically attaches the Google identity to
the matching existing account — same login, same projects, no duplicate. The
client simply clicks **Continue with Google instead** on the first-login screen
(or **Sign in with Google** on the login screen next time).

**Status: live and verified (2026-06-13).** Tested end-to-end — a client
created with a Gmail address signs in with Google, lands on their project list,
and appears as **one** user with **two identities** (email + google) in Auth →
Users. Sessions persist in a normal browser (auto-refresh); a private/incognito
window logs out on close, which is expected.

**Test it:** create a test client with your own Gmail, click Continue with
Google, confirm you land on the project list and that **Auth → Users** shows
**one** user with **two identities** (email + google), not two users.

### What you get

- Client acts on a stage → **you get an email** saying who did what.
- You submit a stage → **the client gets an email** that it's ready.
- **New client account** form in the admin panel (no more Supabase dashboard).
- **Forgot password?** on the client login page — resets handle themselves.

## 6. Day-to-day

- **Admin panel:** strangegoose.co.uk/admin/
- **Client portal (send this to clients):** strangegoose.co.uk/client/

### Adding a new client

1. In the admin panel, use the **New client account** form — type their
   email (and optional display name). A temporary password is generated
   and shown to you.
2. Email the client the credentials and the portal link. They'll be made
   to choose a new password on first sign-in. (Clients can also reset a
   forgotten password themselves via "Forgot password?" on the login page.)
3. Create a project and pick their account.

### Editing, archiving or deleting a client

In the admin panel's **Clients** panel:
- **Edit** — the name and email are always editable inline; **Save** lights
  up when you change something. Email changes update their login too.
- **Archive** — hides the client and blocks their sign-in, but keeps all
  their records. This is the normal way to "remove" a client (offboarding,
  abandoned projects). Archived clients appear in a separate list with
  **Restore**.
- **Delete permanently** (archived clients only) — destroys the account and
  any non-completed projects, freeing up the email address. Blocked for any
  client with a completed project. Use it only to reclaim test emails.

### Finishing a project

1. Client accepts the final version (stage 6).
2. Add the deliverable download links to the Deliverables stage, then click
   **Release deliverables to client** in the bottom panel once you've been
   paid. The client is emailed that their files are ready.
3. The client downloads and clicks **All files downloaded and checked**,
   which completes the project automatically — or, if they don't get round
   to it, check in with them and click **Mark project complete (on client's
   behalf)**.
4. When complete, generate the end-of-project PDF record (button in the
   completion panel) and send the client a copy.

### Running a project

- Paste Google Drive links and YouTube video IDs into each stage as you go.
  (Video ID is the part after `watch?v=` in a YouTube URL. Use *unlisted*
  YouTube videos — private ones won't embed.)
- The client only sees a stage once you click **Advance** on it; the button
  unlocks when they've approved the previous stage.
- Approvals are permanent: timestamped, tied to the client's account, and
  can't be undone or deleted — by anyone, including you.
- At stage 7, paste the deliverable Drive links and click
  **Mark project complete** — that's what reveals the download links to
  the client.

### MCP access

- The **MCP access** nav page lets you generate your own MCP key, so you can
  connect an AI assistant (Claude, ChatGPT, etc.) to the admin panel as a
  conversational alternative to this web interface — not a replacement for
  it.
- Click **Generate a new MCP key** — you won't see the plaintext again (only
  its hash is stored), so copy whichever connection form you need straight
  from the page:
  - **Claude.ai / ChatGPT (web or app):** their custom-connector settings
    only take a URL, no header field, so the page gives you a ready-made URL
    with the key baked in (`…/sgp-admin-mcp?key=YOUR_KEY`) — paste that
    straight into Settings → Connectors.
  - **Claude Code (CLI):** sends the key as a header instead:
    ```
    claude mcp add --transport http sgp-admin \
      https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-admin-mcp \
      --header "Authorization: Bearer YOUR_KEY"
    ```
  Then ask things like "what needs my attention?" or "show me Jane's
  projects."
- It can search/read everything (clients, projects, chase log) and make
  small safe edits (add a chase-log note, update a stage's doc/video links)
  — but it can never advance a stage, release deliverables, mark a project
  complete, or touch a client account. Those stay here, in the admin panel,
  on purpose.
- Revoke a key any time from the same page if you think it's leaked.
