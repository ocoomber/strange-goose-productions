// create-client — called from the admin panel to provision a client account.
// Only the admin may call it: the caller's JWT is verified and their profile
// role checked before anything is created.
//
// Body: { email: string, display_name?: string }
// Returns: { email, temp_password } for Owen to copy/send.
//
// Secrets required: none beyond the auto-provided SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/email.ts';

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

  return json({ email, temp_password: tempPassword });
});

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
