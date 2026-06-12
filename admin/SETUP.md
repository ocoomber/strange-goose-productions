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

### Editing or deleting a client

In the admin panel's **Clients** panel:
- **Edit** — fix a typo'd name or change their email. Email changes update
  their login too.
- **Delete** — removes the account. If the client has projects, deleting
  also permanently removes those projects and their approval records (you'll
  be warned with the count first). Use for cleaning up test accounts; for a
  real client, only delete when you genuinely want their record gone.

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
