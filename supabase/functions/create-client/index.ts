// create-client — called from the admin panel to provision a client account.
// Only the admin may call it: the caller's JWT is verified and their profile
// role checked before anything is created.
//
// Body: { email: string, display_name?: string }
// Returns: { email, temp_password } for Owen to copy/send.
//
// Secrets required: none beyond the auto-provided SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
//
// Self-contained: paste this whole file into the Supabase dashboard editor.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;

  // 1. Verify the caller is the admin.
  const authHeader = req.headers.get('Authorization') || '';
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);
  const { data: profile } = await caller.from('profiles')
    .select('role').eq('id', userData.user.id).single();
  if (profile?.role !== 'admin') return json({ error: 'Admin only' }, 403);

  // 2. Validate input.
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body' }, 400);
  }
  const email = String(body.email || '').trim().toLowerCase();
  const displayName = String(body.display_name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Invalid email address' }, 400);
  }

  // 3. Create the auth user with a generated temp password. The DB trigger
  //    creates the profile row (role=client, must_change_password=true).
  const tempPassword = generatePassword();
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : {},
  });
  if (createErr) return json({ error: createErr.message }, 400);

  // Email the client their login automatically (best effort — if it fails,
  // Owen still gets the password back to send manually).
  let emailed = false;
  let emailError: string | null = null;
  try {
    await sendWelcome(email, displayName, tempPassword);
    emailed = true;
  } catch (err) {
    emailError = String(err);
  }

  return json({ email, temp_password: tempPassword, emailed, email_error: emailError });
});

const PORTAL_URL = 'https://www.strangegoose.co.uk/client/';
const FROM = 'Strange Goose Productions <portal@strangegoose.co.uk>';

async function sendWelcome(to: string, name: string, tempPassword: string): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('RESEND_API_KEY not set');
  const content = {
    heading: name ? `Welcome, ${name}` : 'Welcome to your client portal',
    paragraphs: [
      'Strange Goose Productions has set up your client portal, where you can ' +
      'follow your project and approve each stage as it’s ready.',
    ],
    button: { label: 'Sign in to your portal', url: PORTAL_URL },
    info: [
      { label: 'Email', value: to },
      { label: 'Temporary password', value: tempPassword },
    ],
    outro: 'You’ll be asked to choose your own password the first time you sign in.',
  };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to,
      subject: 'Your Strange Goose Productions client portal login',
      text: plainEmail(content),
      html: brandedEmail(content),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend failed (${res.status}): ${body}`);
  }
}

// ── Branded email template (shared shape across SGP portal emails) ──
type EmailContent = {
  heading: string;
  paragraphs?: string[];
  button?: { label: string; url: string };
  info?: { label: string; value: string }[];
  outro?: string;
};

function esc(s: string): string {
  return String(s).replace(/[&<>]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

function brandedEmail(o: EmailContent): string {
  const paras = (o.paragraphs || []).map((p) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#2a2622">${esc(p)}</p>`).join('');
  const button = o.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr>` +
      `<td style="background:#8a4d23;border-radius:3px"><a href="${o.button.url}" ` +
      `style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;` +
      `color:#f5f2ec;text-decoration:none;font-family:Arial,sans-serif">${esc(o.button.label)}</a></td></tr></table>`
    : '';
  const info = (o.info && o.info.length)
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
      `style="background:#ebe7dd;border:1px solid #d9d3c6;border-radius:3px;margin:0 0 20px"><tr>` +
      `<td style="padding:14px 16px;font-family:'Courier New',monospace;font-size:14px;color:#14120f;line-height:1.8">` +
      o.info.map((r) =>
        `<span style="color:#5a5449">${esc(r.label)}:</span> ${esc(r.value)}`).join('<br>') +
      `</td></tr></table>`
    : '';
  const outro = o.outro
    ? `<p style="margin:0 0 4px;font-size:13px;line-height:1.5;color:#5a5449">${esc(o.outro)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#e3dfd3">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e3dfd3;padding:28px 12px"><tr><td align="center">` +
    `<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#f5f2ec;border:1px solid #d9d3c6;border-radius:4px">` +
    `<tr><td style="padding:28px 30px;font-family:Arial,sans-serif">` +
    `<p style="margin:0 0 20px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8a8376">Strange Goose Productions</p>` +
    `<h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;color:#14120f">${esc(o.heading)}</h1>` +
    paras + button + info + outro +
    `</td></tr></table>` +
    `<p style="margin:16px 0 0;font-size:11px;color:#8a8376;font-family:Arial,sans-serif">strangegoose.co.uk</p>` +
    `</td></tr></table></body></html>`;
}

function plainEmail(o: EmailContent): string {
  let t = `${o.heading}\n\n`;
  (o.paragraphs || []).forEach((p) => { t += `${p}\n\n`; });
  if (o.button) t += `${o.button.label}: ${o.button.url}\n\n`;
  if (o.info) { o.info.forEach((r) => { t += `${r.label}: ${r.value}\n`; }); t += '\n'; }
  if (o.outro) t += `${o.outro}\n\n`;
  return t + 'Strange Goose Productions';
}

// Readable but strong: three word-like chunks + digits, ~60 bits.
function generatePassword(): string {
  const chunk = () => {
    const consonants = 'bcdfghjkmnpqrstvwxz';
    const vowels = 'aeiou';
    let s = '';
    for (let i = 0; i < 3; i++) {
      s += pick(consonants) + pick(vowels);
    }
    return s;
  };
  const digits = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900 + 100);
  return `${chunk()}-${chunk()}-${digits}`;
}

function pick(s: string): string {
  return s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
