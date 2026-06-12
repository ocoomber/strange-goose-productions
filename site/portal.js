/* Strange Goose · client portal shared helpers
   Requires: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   loaded before this file. */

/* ── Supabase project credentials ─────────────────────────────
   Paste these from Supabase → Project Settings → API.
   The anon key is public by design; Row Level Security is the
   actual access control. */
var SUPABASE_URL = 'https://zawrkuclsdqtvftfothj.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_-YJbebdIzYbf3JzzbriBGA_VWdiUarh';

if (SUPABASE_URL.indexOf('https://') !== 0) {
  document.addEventListener('DOMContentLoaded', function () {
    document.body.innerHTML =
      '<p style="font-family:monospace;padding:48px;">Portal not configured yet — ' +
      'paste the Supabase URL and anon key into site/portal.js (see admin/SETUP.md).</p>';
  });
  throw new Error('Supabase credentials not configured');
}

var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

var STAGE_COUNT = 7;

async function getSession() {
  var res = await sb.auth.getSession();
  return res.data.session || null;
}

async function getProfile() {
  var session = await getSession();
  if (!session) return null;
  var res = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  return res.data || null;
}

async function signIn(email, password) {
  var res = await sb.auth.signInWithPassword({ email: email, password: password });
  if (res.error) throw res.error;
  return res.data;
}

async function signOut() {
  await sb.auth.signOut();
  window.location.reload();
}

/* Forced password change on first login */
async function changePassword(newPassword) {
  var res = await sb.auth.updateUser({ password: newPassword });
  if (res.error) throw res.error;
  var session = await getSession();
  var upd = await sb.from('profiles')
    .update({ must_change_password: false })
    .eq('id', session.user.id);
  if (upd.error) throw upd.error;
}

/* ── small DOM helpers ── */
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* Click-to-play YouTube embed — same pattern as the main site:
   thumbnail first, iframe with autoplay on click. */
function ytEmbed(videoId) {
  var box = el('div', 'portal-yt');
  box.setAttribute('data-yt', videoId);
  var img = el('img');
  img.src = 'https://i.ytimg.com/vi/' + videoId + '/maxresdefault.jpg';
  img.alt = 'Video preview';
  img.loading = 'lazy';
  var play = el('span', 'portal-yt-play');
  box.appendChild(img);
  box.appendChild(play);
  box.addEventListener('click', function () {
    var frame = document.createElement('iframe');
    frame.src = 'https://www.youtube-nocookie.com/embed/' + videoId +
      '?autoplay=1&rel=0&modestbranding=1';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    frame.allowFullscreen = true;
    box.innerHTML = '';
    box.appendChild(frame);
    box.classList.add('playing');
  }, { once: true });
  return box;
}

/* Render a list of {label, url} links */
function linkList(links, cls) {
  var ul = el('ul', cls || 'portal-links');
  (links || []).forEach(function (l) {
    var li = el('li');
    var a = el('a', null, l.label || l.url);
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener';
    li.appendChild(a);
    ul.appendChild(li);
  });
  return ul;
}

function showError(node, err) {
  node.textContent = (err && err.message) ? err.message : String(err);
  node.hidden = false;
}
