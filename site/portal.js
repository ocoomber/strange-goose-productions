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

function ytEmbed(rawId) {
  var videoId = parseYouTubeId(rawId);
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

/* Add a Show/Hide toggle to every password input (helps on phones). */
function enablePasswordToggles() {
  var inputs = document.querySelectorAll('input[type="password"]');
  Array.prototype.forEach.call(inputs, function (inp) {
    if (inp.dataset.pwToggled) return;
    inp.dataset.pwToggled = '1';
    var wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.textContent = 'Show';
    btn.setAttribute('aria-label', 'Show password');
    btn.addEventListener('click', function () {
      var hidden = inp.type === 'password';
      inp.type = hidden ? 'text' : 'password';
      btn.textContent = hidden ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    });
    wrap.appendChild(btn);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enablePasswordToggles);
} else {
  enablePasswordToggles();
}
