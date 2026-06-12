// manage-client — admin-only: edit or delete a client account.
// Only the admin may call it (caller JWT verified, profile role checked).
//
// Body:
//   { action: 'update', id, email?, display_name? }
//   { action: 'delete', id }
//
// Delete removes the client's projects (and their stages + approvals) and
// the auth user. It is wholesale account removal — guarded by an admin-only
// check and an explicit confirmation in the UI.
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

  // 2. Parse input.
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body' }, 400);
  }
  const id = String(body.id || '');
  if (!id) return json({ error: 'Missing client id' }, 400);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Guard: never let the admin edit/delete their own (admin) account here.
  const { data: target } = await admin.from('profiles')
    .select('role').eq('id', id).single();
  if (!target) return json({ error: 'Client not found' }, 404);
  if (target.role !== 'client') return json({ error: 'Not a client account' }, 400);

  if (body.action === 'update') {
    const display_name = body.display_name != null
      ? String(body.display_name).trim() : undefined;
    const email = body.email != null
      ? String(body.email).trim().toLowerCase() : undefined;
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Invalid email address' }, 400);
    }
    if (email !== undefined) {
      const { error: authErr } = await admin.auth.admin.updateUserById(id, {
        email,
        email_confirm: true,
      });
      if (authErr) return json({ error: authErr.message }, 400);
    }
    const patch: Record<string, string> = {};
    if (display_name !== undefined) patch.display_name = display_name;
    if (email !== undefined) patch.email = email;
    if (Object.keys(patch).length) {
      const { error: profErr } = await admin.from('profiles')
        .update(patch).eq('id', id);
      if (profErr) return json({ error: profErr.message }, 400);
    }
    return json({ ok: true });
  }

  if (body.action === 'archive' || body.action === 'unarchive') {
    const archived = body.action === 'archive';
    // Disable/enable login by banning the auth user (keeps all their data).
    const { error: banErr } = await admin.auth.admin.updateUserById(id, {
      ban_duration: archived ? '876000h' : 'none',
    });
    if (banErr) return json({ error: banErr.message }, 400);
    const { error: profErr } = await admin.from('profiles')
      .update({ archived }).eq('id', id);
    if (profErr) return json({ error: profErr.message }, 400);
    return json({ ok: true });
  }

  if (body.action === 'delete') {
    // Completed projects are a permanent business record — a client with any
    // completed project cannot be deleted. Delete is for edge cases only
    // (test accounts, projects abandoned before real work, etc.).
    const { data: projects } = await admin.from('projects')
      .select('id, status').eq('client_id', id);
    const projectIds = (projects || []).map((p) => p.id);
    if ((projects || []).some((p) => p.status === 'complete')) {
      return json({
        error: 'This client has a completed project — their record cannot be deleted.',
      }, 400);
    }
    let deletedProjects = 0;
    if (projectIds.length) {
      await admin.from('approvals').delete().in('project_id', projectIds);
      const { error: delProjErr } = await admin.from('projects')
        .delete().in('id', projectIds); // cascades to stages
      if (delProjErr) return json({ error: delProjErr.message }, 400);
      deletedProjects = projectIds.length;
    }
    const { error: delUserErr } = await admin.auth.admin.deleteUser(id);
    if (delUserErr) return json({ error: delUserErr.message }, 400);
    return json({ ok: true, deleted_projects: deletedProjects });
  }

  return json({ error: 'Unknown action' }, 400);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
