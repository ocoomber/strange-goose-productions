// notify — Database Webhook target.
// Sends email when:
//   • approvals INSERT  → notify Owen (ADMIN_EMAIL) that the client acted
//   • stages UPDATE locked→pending → notify the project's client that a
//     new stage is ready for them
//
// Secured by a shared secret: the webhook must send header
//   x-webhook-secret: <WEBHOOK_SECRET>
//
// Secrets required: RESEND_API_KEY, ADMIN_EMAIL, WEBHOOK_SECRET
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
//
// Self-contained: paste this whole file into the Supabase dashboard editor.

import { createClient } from 'npm:@supabase/supabase-js@2';

const PORTAL_URL = 'https://www.strangegoose.co.uk/client/';
const FROM = 'Strange Goose Productions <portal@strangegoose.co.uk>';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Mirrors STAGE_ACTIONS[x].done in site/portal.js
const DONE_LABEL: Record<number, string> = {
  1: 'approved the brief on',
  2: 'confirmed their Edit v1 feedback (round 1 of 2) on',
  3: 'confirmed their Edit v2 feedback (round 2 of 2) on',
  4: 'acknowledged the picture lock on',
  5: 'confirmed their colour & sound feedback on',
  6: 'accepted the final version of',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const secret = Deno.env.get('WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Bad payload' }, 400);
  }

  try {
    // Client acted → tell Owen
    if (payload.table === 'approvals' && payload.type === 'INSERT') {
      const rec = payload.record;
      const [{ data: stage }, { data: project }, { data: client }] =
        await Promise.all([
          admin.from('stages').select('stage_index, name')
            .eq('id', rec.stage_id).single(),
          admin.from('projects').select('title')
            .eq('id', rec.project_id).single(),
          admin.from('profiles').select('email, display_name')
            .eq('id', rec.client_id).single(),
        ]);
      const who = client?.display_name || client?.email || 'The client';
      const action = DONE_LABEL[stage?.stage_index ?? 0] || 'completed a stage on';
      await sendEmail(Deno.env.get('ADMIN_EMAIL')!,
        `SGP Portal: ${who} ${action} "${project?.title}"`, {
          heading: `${who} ${action} “${project?.title}”`,
          paragraphs: ['The next move is yours.'],
          button: { label: 'Open the admin panel', url: 'https://www.strangegoose.co.uk/admin/' },
          info: [
            { label: 'Stage', value: String(rec.stage_name || stage?.name) },
            { label: 'Recorded', value: String(rec.approved_at) },
          ],
        });
      return json({ ok: true });
    }

    // Owen submitted a stage → tell the client
    if (
      payload.table === 'stages' && payload.type === 'UPDATE' &&
      payload.old_record?.state === 'locked' &&
      payload.record?.state === 'pending'
    ) {
      const rec = payload.record;
      const { data: project } = await admin.from('projects')
        .select('title, client_id, profiles(email, display_name)')
        .eq('id', rec.project_id).single();
      const to = (project as any)?.profiles?.email;
      if (!to) return json({ error: 'No client email found' }, 200);
      const isDeliverables = rec.stage_index === 7;
      await sendEmail(to,
        isDeliverables
          ? `Your deliverables are being prepared — ${project?.title}`
          : `Ready for your review — ${project?.title}`,
        isDeliverables
          ? {
            heading: 'Your deliverables are being prepared',
            paragraphs: [
              `Your project “${project?.title}” has reached the Deliverables stage. ` +
              'We’re preparing your final files — you’ll find the download links in ' +
              'the portal once they’re released.',
            ],
            button: { label: 'Open your portal', url: PORTAL_URL },
          }
          : {
            heading: 'Ready for your review',
            paragraphs: [
              `“${rec.name}” is now ready for you on your project “${project?.title}”. ` +
              'Sign in to review it and record your response.',
            ],
            button: { label: 'Review it now', url: PORTAL_URL },
          });
      return json({ ok: true });
    }

    // Anything else (e.g. other stage updates) — acknowledge, no email.
    return json({ ok: true, skipped: true });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
