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
      await sendEmail({
        to: Deno.env.get('ADMIN_EMAIL')!,
        subject: `SGP Portal: ${who} ${action} "${project?.title}"`,
        text:
          `${who} ${action} "${project?.title}".\n\n` +
          `Stage: ${rec.stage_name || stage?.name}\n` +
          `Recorded: ${rec.approved_at}\n\n` +
          `Next move is yours — open the admin panel:\n` +
          `https://www.strangegoose.co.uk/admin/`,
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
      await sendEmail({
        to,
        subject: isDeliverables
          ? `Your deliverables are being prepared — ${project?.title}`
          : `Ready for your review — ${project?.title}`,
        text: isDeliverables
          ? `Hello,\n\nYour project "${project?.title}" has reached the ` +
            `Deliverables stage. We're preparing your final files — you'll ` +
            `find them in the portal once released.\n\n${PORTAL_URL}\n\n` +
            `Strange Goose Productions`
          : `Hello,\n\n"${rec.name}" is now ready for you on your project ` +
            `"${project?.title}".\n\nSign in to review it:\n${PORTAL_URL}\n\n` +
            `Strange Goose Productions`,
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

async function sendEmail(opts: { to: string; subject: string; text: string }): Promise<void> {
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
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: '<div style="font-family:sans-serif;white-space:pre-wrap">' +
        escapeHtml(opts.text) + '</div>',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend failed (${res.status}): ${body}`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
