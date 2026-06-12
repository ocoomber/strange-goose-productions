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

## 5. Day-to-day

- **Admin panel:** strangegoose.co.uk/admin/
- **Client portal (send this to clients):** strangegoose.co.uk/client/

### Adding a new client

1. Supabase dashboard → **Authentication → Users → Add user** — client's
   email + a temporary password. Tick "Auto confirm user".
2. Email the client their credentials and the portal link. They'll be made
   to choose a new password on first sign-in.
3. In the admin panel, create a project and pick their account.

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
