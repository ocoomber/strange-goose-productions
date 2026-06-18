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

/* Per-stage client action wording. The underlying record is identical
   (timestamped, account-tied, permanent); only the meaning/labels differ.
   Stage 7 (Deliverables) has no client action — it's file handover. */
var STAGE_ACTIONS = {
  1: {
    btn: 'Approve brief',
    done: 'Approved',
    note: 'Review the linked brief, then approve to confirm it as agreed.',
    confirm: 'Approve this brief as the agreed basis for the project?',
    next: "We're now in production. Edit v1 will appear here as the next stage once it's ready for you."
  },
  2: {
    btn: 'Confirm feedback sent — proceed',
    done: 'Feedback confirmed',
    note: 'Watch Edit v1 and send any feedback to us by email, then confirm here to use feedback round 1 of 2.',
    confirm: 'Confirm you have sent your feedback on Edit v1 and are happy to proceed? This uses feedback round 1 of 2.',
    next: "We're working your feedback into Edit v2 — it will appear here as the next stage once submitted."
  },
  3: {
    btn: 'Confirm feedback sent — proceed',
    done: 'Feedback confirmed',
    note: 'Watch Edit v2 and send any feedback to us by email, then confirm here to use feedback round 2 of 2.',
    confirm: 'Confirm you have sent your feedback on Edit v2 and are happy to proceed? This uses your second and final included feedback round.',
    next: "We're working your final feedback round into the picture lock — it will appear here once ready."
  },
  4: {
    btn: 'Acknowledge picture lock',
    done: 'Acknowledged',
    note: 'This is the locked picture. Your two included feedback rounds are complete — any further edit changes from here are a separate, chargeable request.',
    confirm: 'Acknowledge this as the locked picture? Further edit changes after this point fall outside the agreement and are chargeable.',
    next: "The picture is locked. We're now moving into colour grading and sound — that version will appear here next."
  },
  5: {
    btn: 'Confirm feedback sent — proceed',
    done: 'Feedback confirmed',
    note: 'Watch the colour & sound version and send any feedback by email, then confirm here to use your one included round.',
    confirm: 'Confirm you have sent your feedback on the colour & sound version and are happy to proceed? This uses your one included round.',
    next: "We're working your feedback into the final colour and sound. The finished film will appear here next."
  },
  6: {
    btn: 'Accept final version',
    done: 'Accepted',
    note: 'This is the finished film. Accepting confirms you are happy with the final version; we will then issue the final invoice.',
    confirm: 'Accept this as the final, finished version of your film?',
    next: "Thank you — we'll be in touch with the final invoice. Your deliverables will unlock here once everything is settled."
  }
};

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

async function signInWithGoogle() {
  var res = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/client/' }
  });
  if (res.error) throw res.error;
  return res.data;
}

/* True if the current session authenticated via the Google provider. */
function signedInWithGoogle(session) {
  if (!session || !session.user) return false;
  if (session.user.app_metadata && session.user.app_metadata.provider === 'google') return true;
  var ids = (session.user.identities || []);
  return ids.some(function (i) { return i.provider === 'google'; });
}

async function signOut() {
  await sb.auth.signOut();
  window.location.reload();
}

/* Clear the first-login flag for the current user. */
async function clearMustChangePassword() {
  var session = await getSession();
  if (!session) return;
  var upd = await sb.from('profiles')
    .update({ must_change_password: false })
    .eq('id', session.user.id);
  if (upd.error) throw upd.error;
}

/* Forced password change on first login */
async function changePassword(newPassword) {
  var res = await sb.auth.updateUser({ password: newPassword });
  if (res.error) throw res.error;
  await clearMustChangePassword();
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
/* Accept a bare video ID or any common YouTube URL and return the ID. */
function parseYouTubeId(input) {
  if (!input) return '';
  var s = String(input).trim();
  if (/^[\w-]{11}$/.test(s)) return s;                 // already a bare ID
  var m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([\w-]{11})/);
  if (m) return m[1];
  var tail = s.match(/([\w-]{11})(?:[?&].*)?$/);        // last-resort: 11-char tail
  return tail ? tail[1] : s;
}

/* Shared fullscreen lightbox player. Lazily created once, reused for every
   thumbnail click so the video opens at a proper review size (and the client
   never has to bounce out to YouTube). Closes via ×, backdrop click, or Esc;
   closing tears down the iframe so playback stops. */
var _ytLightbox = null;
function ytLightbox() {
  if (_ytLightbox) return _ytLightbox;
  var lb = el('div', 'yt-lightbox');
  lb.setAttribute('aria-hidden', 'true');
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Video player');
  var inner = el('div', 'yt-lb-inner');
  var close = el('button', 'yt-lb-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close video');
  close.textContent = 'Close ✕';
  var stage = el('div', 'yt-lb-stage');
  inner.appendChild(close);
  inner.appendChild(stage);
  lb.appendChild(inner);

  function hide() {
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
    stage.innerHTML = '';          // tear down iframe → stops playback
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') hide(); }

  close.addEventListener('click', hide);
  lb.addEventListener('click', function (e) { if (e.target === lb) hide(); });

  document.body.appendChild(lb);
  _ytLightbox = { el: lb, stage: stage, hide: hide, onKey: onKey };
  return _ytLightbox;
}

function openYtLightbox(videoId) {
  var lb = ytLightbox();
  var frame = document.createElement('iframe');
  frame.src = 'https://www.youtube-nocookie.com/embed/' + videoId +
    '?autoplay=1&rel=0&modestbranding=1';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
  frame.allowFullscreen = true;
  lb.stage.innerHTML = '';
  lb.stage.appendChild(frame);
  lb.el.classList.add('open');
  lb.el.setAttribute('aria-hidden', 'false');
  document.addEventListener('keydown', lb.onKey);
}

function ytEmbed(rawId) {
  var videoId = parseYouTubeId(rawId);
  var box = el('div', 'portal-yt');
  box.setAttribute('data-yt', videoId);
  box.setAttribute('role', 'button');
  box.setAttribute('tabindex', '0');
  box.setAttribute('aria-label', 'Play video to review');
  var img = el('img');
  img.src = 'https://i.ytimg.com/vi/' + videoId + '/maxresdefault.jpg';
  img.alt = 'Video preview';
  img.loading = 'lazy';
  var play = el('span', 'portal-yt-play');
  var cue = el('span', 'portal-yt-cue', 'Click to review');
  box.appendChild(img);
  box.appendChild(play);
  box.appendChild(cue);
  box.addEventListener('click', function () { openYtLightbox(videoId); });
  box.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openYtLightbox(videoId); }
  });
  return box;
}

/* Only allow safe link schemes — stored links come from the admin (incl. the
   admin MCP's update_stage_links), so a javascript:/data: URL would otherwise
   execute in the viewer's session on click. Anything else renders inert. */
function safeUrl(u) {
  return /^(https?:|mailto:)/i.test(String(u || '').trim()) ? u : '#';
}

/* Render a list of {label, url} links */
function linkList(links, cls) {
  var ul = el('ul', cls || 'portal-links');
  (links || []).forEach(function (l) {
    var li = el('li');
    var a = el('a', null, l.label || l.url);
    a.href = safeUrl(l.url);
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

/* Add a Show/Hide password toggle beneath every password input. Placed below
   the field (not inside it) so it never collides with the browser's own
   password-reveal icon — which is what breaks inside-the-field toggles on
   Android Chrome. */
function enablePasswordToggles() {
  var inputs = document.querySelectorAll('input[type="password"]');
  Array.prototype.forEach.call(inputs, function (inp) {
    if (inp.dataset.pwToggled) return;
    inp.dataset.pwToggled = '1';
    var label = document.createElement('label');
    label.className = 'pw-toggle';
    var box = document.createElement('input');
    box.type = 'checkbox';
    var text = document.createElement('span');
    text.textContent = 'Show password';
    label.appendChild(box);
    label.appendChild(text);
    box.addEventListener('change', function () {
      inp.type = box.checked ? 'text' : 'password';
    });
    if (inp.nextSibling) inp.parentNode.insertBefore(label, inp.nextSibling);
    else inp.parentNode.appendChild(label);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enablePasswordToggles);
} else {
  enablePasswordToggles();
}
