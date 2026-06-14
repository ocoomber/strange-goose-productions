// resend-notification — admin-only: re-send the "ready for you" email to the
// client for a stage that is already pending. Used when the original
// locked→pending notification was missed/lost; it does NOT change any data,
// it only re-sends the same email the `notify` webhook sends on submit.
//
// Body: { stage_id }
//
// Caller JWT is verified and the profile role is checked (admin only). The
// target stage must be in the 'pending' state — you can only re-notify about
// something the client is actually waiting on.
//
// Secrets required: RESEND_API_KEY
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are provided
// automatically.)
//
// Self-contained: paste this whole file into the Supabase dashboard editor.

import { createClient } from 'npm:@supabase/supabase-js@2';

const PORTAL_URL = 'https://www.strangegoose.co.uk/client/';
const FROM = 'Strange Goose Productions <portal@strangegoose.co.uk>';

// Browser callers are the SGP portal pages, served from both the apex and www
// hosts; reflect whichever of the two made the request (else fall back to the
// apex). Replaces the previous wildcard '*'.
const ALLOWED_ORIGINS = [
  'https://strangegoose.co.uk',
  'https://www.strangegoose.co.uk',
];
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
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

  // 2. Parse input.
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body' }, 400);
  }
  const stageId = String(body.stage_id || '');
  if (!stageId) return json({ error: 'Missing stage_id' }, 400);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 3. Load the stage + project + client.
  const { data: stage } = await admin.from('stages')
    .select('id, name, state, stage_index, project_id')
    .eq('id', stageId).single();
  if (!stage) return json({ error: 'Stage not found' }, 404);
  if (stage.state !== 'pending') {
    return json({ error: 'This stage is not awaiting the client, so there is nothing to re-send.' }, 400);
  }

  const { data: project } = await admin.from('projects')
    .select('title, profiles(email, display_name)')
    .eq('id', stage.project_id).single();
  const to = (project as any)?.profiles?.email;
  if (!to) return json({ error: 'No client email found for this project.' }, 400);

  // 4. Re-send the same email the notify webhook sends on locked→pending.
  const isDeliverables = stage.stage_index === 7;
  try {
    await sendEmail(to,
      isDeliverables
        ? `Your files are ready to download — ${project?.title}`
        : `Ready for your review — ${project?.title}`,
      isDeliverables
        ? {
          heading: 'Your files are ready to download',
          paragraphs: [
            `The final files for your project “${project?.title}” are ready in the portal. ` +
            'Please download and check everything, then confirm you have it all.',
          ],
          button: { label: 'Download your files', url: PORTAL_URL },
        }
        : {
          heading: 'Ready for your review',
          paragraphs: [
            `“${stage.name}” is now ready for you on your project “${project?.title}”. ` +
            'Sign in to review it and record your response.',
          ],
          button: { label: 'Review it now', url: PORTAL_URL },
        });
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function sendEmail(to: string, subject: string, content: EmailContent): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('RESEND_API_KEY not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to,
      subject,
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
