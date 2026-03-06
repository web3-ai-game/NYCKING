// ═══════════════════════════════════════════════════
// NYCKING Match — Random user matching → Add Friend → Chat
// ═══════════════════════════════════════════════════

(function () {
  const $ = (id) => document.getElementById(id);
  const API = window.NYCKING_API_BASE || '';
  const auth = window.NYCKING_AUTH;

  const statusEl = $('match-status');
  const subEl = $('match-sub');
  const iconEl = $('match-icon');
  const actionsEl = $('match-actions');
  const resultEl = $('match-result');
  const avatarEl = $('match-avatar');
  const nameEl = $('match-name');

  let pollTimer = null;
  let matchedConvId = null;
  let matchedUid = null;

  async function authHeaders() {
    if (!auth?.currentUser) return {};
    const token = await auth.currentUser.getIdToken();
    return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  }

  function setState(state, data) {
    if (state === 'idle') {
      iconEl.innerHTML = '&#x1F4AB;';
      iconEl.style.animationPlayState = 'paused';
      statusEl.textContent = 'Find Someone to Chat';
      subEl.textContent = 'Get randomly matched with another user for a bilingual conversation';
      actionsEl.innerHTML = '<button class="match-btn start" id="match-start-btn">&#x1F50D; Start Matching</button>';
      resultEl.style.display = 'none';
      matchedConvId = null;
      matchedUid = null;
      $('match-start-btn').addEventListener('click', startMatch);
    } else if (state === 'waiting') {
      iconEl.innerHTML = '&#x1F4AB;';
      iconEl.style.animationPlayState = 'running';
      statusEl.textContent = 'Searching...';
      subEl.textContent = 'Looking for someone to chat with...';
      actionsEl.innerHTML = '<button class="match-btn cancel" id="match-cancel-btn">&#x2715; Cancel</button>';
      resultEl.style.display = 'none';
      $('match-cancel-btn').addEventListener('click', cancelMatch);
    } else if (state === 'matched') {
      iconEl.innerHTML = '&#x1F389;';
      iconEl.style.animationPlayState = 'paused';
      statusEl.textContent = 'Match Found!';
      subEl.textContent = '';
      matchedConvId = data?.conversationId;
      matchedUid = data?.uid;
      avatarEl.textContent = data?.avatar || '😊';
      nameEl.textContent = data?.displayName || 'User';
      resultEl.style.display = '';
      // Show both "Add Friend" and "Start Chat" buttons
      actionsEl.innerHTML =
        '<button class="match-btn start" id="match-addfriend-btn" style="margin-bottom:8px">&#x1F465; Add Friend</button>' +
        '<button class="match-btn chat" id="match-chat-btn" style="background:var(--success);color:#fff">&#x1F4AC; Start Chat</button>' +
        '<button class="match-btn cancel" id="match-again-btn" style="margin-top:8px">&#x1F504; Match Again</button>';
      // Add Friend
      $('match-addfriend-btn').addEventListener('click', async () => {
        if (!matchedUid) return;
        const btn = $('match-addfriend-btn');
        btn.disabled = true;
        btn.textContent = '...';
        try {
          const h = await authHeaders();
          const res = await fetch(API + '/api/friends/request', {
            method: 'POST', headers: h,
            body: JSON.stringify({ targetUid: matchedUid })
          });
          const d = await res.json();
          btn.textContent = d.ok ? '✓ Request Sent' : (d.error || 'Already friends');
          btn.style.borderColor = 'var(--success)';
          btn.style.color = 'var(--success)';
        } catch { btn.textContent = 'Error'; }
      });
      // Start Chat
      $('match-chat-btn').addEventListener('click', () => {
        if (!matchedConvId) return;
        // Navigate to DM and open this conversation
        if (window.NYCKING_SHOW) window.NYCKING_SHOW('dm-screen');
        // Trigger DM chat open if social.js exposes it
        setTimeout(() => {
          const convRow = document.querySelector('.dm-conv[data-cid="' + matchedConvId + '"]');
          if (convRow) convRow.click();
        }, 500);
      });
      // Match Again
      $('match-again-btn').addEventListener('click', () => setState('idle'));
    }
  }

  async function startMatch() {
    setState('waiting');
    try {
      const h = await authHeaders();
      const res = await fetch(API + '/api/match/join', { method: 'POST', headers: h, body: JSON.stringify({}) });
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
      await fetch(API + '/api/match/leave', { method: 'POST', headers: h });
    } catch {}
    setState('idle');
  }

  async function checkStatus() {
    try {
      const h = await authHeaders();
      const res = await fetch(API + '/api/match/status', { headers: h });
      const d = await res.json();
      if (d.status === 'matched') {
        stopPoll();
        setState('matched', { ...d.matchedWith, conversationId: d.conversationId });
      }
    } catch {}
  }

  function startPoll() { stopPoll(); pollTimer = setInterval(checkStatus, 3000); }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // Init
  $('match-start-btn').addEventListener('click', startMatch);

  // Cleanup when leaving match screen
  const origShow = window.NYCKING_SHOW;
  window.NYCKING_SHOW = function (id) {
    if (id !== 'match-screen' && pollTimer) cancelMatch();
    if (origShow) origShow(id);
  };
})();
