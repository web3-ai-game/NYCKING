// ═══════════════════════════════════════════════════
// NYCKING Match — Random user matching for chat
// ═══════════════════════════════════════════════════

(function () {
  const $ = (id) => document.getElementById(id);
  const API = window.NYCKING_API_BASE || '';
  const auth = window.NYCKING_AUTH;

  const startBtn = $('match-start-btn');
  const statusEl = $('match-status');
  const subEl = $('match-sub');
  const iconEl = $('match-icon');
  const actionsEl = $('match-actions');
  const resultEl = $('match-result');
  const avatarEl = $('match-avatar');
  const nameEl = $('match-name');
  const chatBtn = $('match-chat-btn');

  let pollTimer = null;
  let matchedConvId = null;

  async function authHeaders() {
    if (!auth?.currentUser) return {};
    const token = await auth.currentUser.getIdToken();
    return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  }

  function setState(state, data) {
    if (state === 'idle') {
      iconEl.textContent = '\u{1F4AB}';
      iconEl.style.animationPlayState = 'paused';
      statusEl.textContent = 'Find Someone to Chat';
      subEl.textContent = 'Get randomly matched with another user for a bilingual conversation';
      actionsEl.innerHTML = '<button class="match-btn start" id="match-start-btn">\u{1F50D} Start Matching</button>';
      resultEl.style.display = 'none';
      $('match-start-btn').addEventListener('click', startMatch);
    } else if (state === 'waiting') {
      iconEl.textContent = '\u{1F4AB}';
      iconEl.style.animationPlayState = 'running';
      statusEl.textContent = 'Searching...';
      subEl.textContent = 'Looking for someone to chat with. Please wait...';
      actionsEl.innerHTML = '<button class="match-btn cancel" id="match-cancel-btn">\u2715 Cancel</button>';
      resultEl.style.display = 'none';
      $('match-cancel-btn').addEventListener('click', cancelMatch);
    } else if (state === 'matched') {
      iconEl.textContent = '\u{1F389}';
      iconEl.style.animationPlayState = 'paused';
      statusEl.textContent = 'Match Found!';
      subEl.textContent = '';
      actionsEl.innerHTML = '';
      resultEl.style.display = '';
      avatarEl.textContent = data?.avatar || '\u{1F60A}';
      nameEl.textContent = data?.displayName || 'User';
      matchedConvId = data?.conversationId;
    }
  }

  async function startMatch() {
    setState('waiting');
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/match/join`, { method: 'POST', headers: h, body: JSON.stringify({}) });
      const d = await res.json();
      if (d.status === 'matched') {
        stopPoll();
        setState('matched', { ...d.matchedWith, conversationId: d.conversationId });
      } else {
        startPoll();
      }
    } catch (err) {
      console.error('[match] join error:', err);
      setState('idle');
    }
  }

  async function cancelMatch() {
    stopPoll();
    try {
      const h = await authHeaders();
      await fetch(`${API}/api/match/leave`, { method: 'POST', headers: h });
    } catch {}
    setState('idle');
  }

  async function checkStatus() {
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/match/status`, { headers: h });
      const d = await res.json();
      if (d.status === 'matched') {
        stopPoll();
        setState('matched', { ...d.matchedWith, conversationId: d.conversationId });
      }
    } catch {}
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(checkStatus, 3000);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // Chat button → open DM
  chatBtn.addEventListener('click', () => {
    if (!matchedConvId) return;
    // Use social.js's openDMChat if available, or navigate to dm-screen
    if (window.NYCKING_SHOW) window.NYCKING_SHOW('dm-screen');
  });

  // Init
  startBtn.addEventListener('click', startMatch);

  // Cleanup when leaving match screen
  const origShow = window.NYCKING_SHOW;
  window.NYCKING_SHOW = function (id) {
    if (id !== 'match-screen' && pollTimer) {
      cancelMatch();
    }
    if (origShow) origShow(id);
  };
})();
