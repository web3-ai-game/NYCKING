// ═══════════════════════════════════════════════════
// NYCKING Social — Friends, DM, Moments
// ═══════════════════════════════════════════════════

(function () {
  const $ = (id) => document.getElementById(id);
  const API = window.NYCKING_API_BASE || '';
  const auth = window.NYCKING_AUTH;
  const db = window.NYCKING_DB;

  async function authHeaders() {
    if (!auth?.currentUser) return {};
    const token = await auth.currentUser.getIdToken();
    return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  }

  function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function timeAgo(iso) {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 60000) return 'now';
    if (d < 3600000) return Math.floor(d/60000) + 'm';
    if (d < 86400000) return Math.floor(d/3600000) + 'h';
    return Math.floor(d/86400000) + 'd';
  }

  // ═══════════════════════════════════════════════
  // CONTACTS TAB
  // ═══════════════════════════════════════════════
  async function loadContacts() {
    const list = $('contacts-list');
    const reqList = $('contacts-requests');
    if (!list) return;
    list.innerHTML = '<div class="social-loading">Loading...</div>';

    try {
      const h = await authHeaders();
      const [fRes, rRes] = await Promise.all([
        fetch(`${API}/api/friends`, { headers: h }),
        fetch(`${API}/api/friends/requests`, { headers: h }),
      ]);
      const fData = await fRes.json();
      const rData = await rRes.json();

      // Pending requests
      if (rData.requests?.length) {
        reqList.innerHTML = '<div class="social-section-title">Friend Requests</div>' +
          rData.requests.map(r => `
            <div class="social-row">
              <span class="social-avatar">${escHtml(r.avatar)}</span>
              <div class="social-info">
                <div class="social-name">${escHtml(r.displayName)}</div>
                <div class="social-sub">@${escHtml(r.username)}</div>
              </div>
              <button class="social-btn accept" data-rid="${r.id}">✓</button>
              <button class="social-btn reject" data-rid="${r.id}">✕</button>
            </div>
          `).join('');
        reqList.style.display = '';
      } else {
        reqList.style.display = 'none';
      }

      // Friends list
      if (fData.friends?.length) {
        list.innerHTML = fData.friends.map(f => `
          <div class="social-row" data-uid="${f.uid}">
            <span class="social-avatar">${escHtml(f.avatar)}</span>
            <div class="social-info">
              <div class="social-name">${escHtml(f.displayName)}</div>
              <div class="social-sub">@${escHtml(f.username)}</div>
            </div>
            <button class="social-btn msg" data-uid="${f.uid}" data-name="${escHtml(f.displayName)}">💬</button>
          </div>
        `).join('');
      } else {
        list.innerHTML = '<div class="social-empty" data-i18n="contacts_empty">No friends yet. Search to add!</div>';
      }
    } catch (err) {
      list.innerHTML = '<div class="social-empty">Failed to load</div>';
    }
  }

  // Accept/reject friend request
  document.addEventListener('click', async (e) => {
    const accept = e.target.closest('.social-btn.accept');
    const reject = e.target.closest('.social-btn.reject');
    if (!accept && !reject) return;
    const rid = (accept || reject).dataset.rid;
    const endpoint = accept ? 'accept' : 'reject';
    try {
      const h = await authHeaders();
      await fetch(`${API}/api/friends/${endpoint}`, { method: 'POST', headers: h, body: JSON.stringify({ requestId: rid }) });
      loadContacts();
    } catch {}
  });

  // Message button → start DM
  document.addEventListener('click', async (e) => {
    const msgBtn = e.target.closest('.social-btn.msg');
    if (!msgBtn) return;
    const uid = msgBtn.dataset.uid;
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/dm/start`, { method: 'POST', headers: h, body: JSON.stringify({ targetUid: uid }) });
      const data = await res.json();
      if (data.conversationId) openDMChat(data.conversationId, msgBtn.dataset.name);
    } catch {}
  });

  // Search friends
  const searchInput = $('contacts-search');
  const searchResults = $('contacts-search-results');
  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length < 2) { searchResults.innerHTML = ''; return; }
      searchTimer = setTimeout(async () => {
        try {
          const h = await authHeaders();
          const res = await fetch(`${API}/api/users/search?q=${encodeURIComponent(q)}`, { headers: h });
          const data = await res.json();
          if (data.results?.length) {
            searchResults.innerHTML = data.results
              .filter(u => u.uid !== auth?.currentUser?.uid)
              .map(u => `
                <div class="social-row">
                  <span class="social-avatar">${escHtml(u.avatar)}</span>
                  <div class="social-info">
                    <div class="social-name">${escHtml(u.displayName)}</div>
                    <div class="social-sub">@${escHtml(u.username)}</div>
                  </div>
                  <button class="social-btn add" data-uid="${u.uid}">+ Add</button>
                </div>
              `).join('');
          } else {
            searchResults.innerHTML = '<div class="social-empty">No users found</div>';
          }
        } catch { searchResults.innerHTML = ''; }
      }, 400);
    });
  }

  // Add friend
  document.addEventListener('click', async (e) => {
    const addBtn = e.target.closest('.social-btn.add');
    if (!addBtn) return;
    addBtn.disabled = true;
    addBtn.textContent = '...';
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/friends/request`, { method: 'POST', headers: h, body: JSON.stringify({ targetUid: addBtn.dataset.uid }) });
      const data = await res.json();
      addBtn.textContent = data.ok ? '✓ Sent' : (data.error || 'Error');
    } catch { addBtn.textContent = 'Error'; }
  });

  // ═══════════════════════════════════════════════
  // DM / MESSAGES TAB
  // ═══════════════════════════════════════════════
  let currentConvId = null;
  let dmPollTimer = null;

  async function loadConversations() {
    const list = $('dm-conv-list');
    if (!list) return;
    list.innerHTML = '<div class="social-loading">Loading...</div>';
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/dm`, { headers: h });
      const data = await res.json();
      if (data.conversations?.length) {
        list.innerHTML = data.conversations.map(c => `
          <div class="social-row dm-conv" data-cid="${c.id}" data-name="${escHtml(c.displayName)}">
            <span class="social-avatar">${escHtml(c.avatar)}</span>
            <div class="social-info">
              <div class="social-name">${escHtml(c.displayName)}</div>
              <div class="social-sub">${escHtml(c.lastMessage || 'No messages yet')}</div>
            </div>
            <span class="social-time">${c.lastMessageAt ? timeAgo(c.lastMessageAt) : ''}</span>
          </div>
        `).join('');
      } else {
        list.innerHTML = '<div class="social-empty" data-i18n="dm_empty">No conversations yet</div>';
      }
    } catch { list.innerHTML = '<div class="social-empty">Failed to load</div>'; }
  }

  // Click conversation → open chat
  document.addEventListener('click', (e) => {
    const conv = e.target.closest('.dm-conv');
    if (!conv) return;
    openDMChat(conv.dataset.cid, conv.dataset.name);
  });

  function openDMChat(convId, name) {
    currentConvId = convId;
    $('dm-chat-name').textContent = name || 'Chat';
    $('dm-list-view').style.display = 'none';
    $('dm-chat-view').style.display = 'flex';
    $('dm-messages').innerHTML = '';
    loadDMMessages();
    startDMPoll();
  }

  function closeDMChat() {
    stopDMPoll();
    currentConvId = null;
    $('dm-list-view').style.display = '';
    $('dm-chat-view').style.display = 'none';
    loadConversations();
  }

  $('dm-chat-back')?.addEventListener('click', closeDMChat);

  async function loadDMMessages() {
    if (!currentConvId) return;
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/dm/${currentConvId}`, { headers: h });
      const data = await res.json();
      const container = $('dm-messages');
      container.innerHTML = '';
      if (data.messages?.length) {
        const myUid = auth?.currentUser?.uid;
        data.messages.forEach(m => {
          appendBubble(container, m, myUid);
        });
        container.scrollTop = container.scrollHeight;
      }
    } catch {}
  }

  function appendBubble(container, m, myUid) {
    const div = document.createElement('div');
    div.className = 'bubble ' + (m.sender === myUid ? 'mine' : 'theirs');
    const translated = m.translatedText ? `<div class="b-translated">${escHtml(m.translatedText)}</div>` : '';
    div.innerHTML = `<div class="b-original">${escHtml(m.text)}</div>${translated}<div style="font-size:9px;color:#444;margin-top:2px">${timeAgo(m.createdAt)}</div>`;
    container.appendChild(div);
    return div;
  }

  function startDMPoll() {
    stopDMPoll();
    dmPollTimer = setInterval(loadDMMessages, 5000);
  }
  function stopDMPoll() {
    if (dmPollTimer) { clearInterval(dmPollTimer); dmPollTimer = null; }
  }

  // Send DM
  $('dm-send-btn')?.addEventListener('click', sendDM);
  $('dm-msg-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendDM(); } });

  async function sendDM() {
    const input = $('dm-msg-input');
    const text = input?.value?.trim();
    if (!text || !currentConvId) return;
    input.value = '';
    const myUid = auth?.currentUser?.uid;
    const now = new Date().toISOString();

    // Instant local append (no wait for server)
    const container = $('dm-messages');
    const tempBubble = appendBubble(container, { text, sender: myUid, createdAt: now }, myUid);
    container.scrollTop = container.scrollHeight;

    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/dm/${currentConvId}`, { method: 'POST', headers: h, body: JSON.stringify({ text }) });
      const data = await res.json();

      // Try auto-translate in background
      translateInBackground(text, tempBubble);

      // Deduct tokens
      if (window.NYCKING_DEDUCT_TOKENS) window.NYCKING_DEDUCT_TOKENS(50, 50);
    } catch {}
  }

  async function translateInBackground(text, bubbleEl) {
    try {
      const user = window.NYCKING_USER;
      const myLang = user?.lang || 'en';
      // Detect: if text looks like user's lang, translate to a common target
      const langMap = { en: 'zh-CN', zh: 'en-US', th: 'en-US', my: 'en-US' };
      const sourceLang = myLang === 'zh' ? 'zh-CN' : myLang === 'th' ? 'th-TH' : myLang === 'my' ? 'my-MM' : 'en-US';
      const targetLang = langMap[myLang] || 'en-US';
      if (sourceLang === targetLang) return;

      const res = await fetch(`${API}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sourceLang, targetLang, scene: 'romance' })
      });
      const data = await res.json();
      if (data.translation && bubbleEl) {
        const existing = bubbleEl.querySelector('.b-translated');
        if (existing) {
          existing.textContent = data.translation;
        } else {
          const tDiv = document.createElement('div');
          tDiv.className = 'b-translated';
          tDiv.textContent = data.translation;
          bubbleEl.querySelector('.b-original').after(tDiv);
        }
        if (window.NYCKING_DEDUCT_TOKENS) window.NYCKING_DEDUCT_TOKENS(data.tokensIn || 0, data.tokensOut || 0);
      }
    } catch {}
  }

  // ═══════════════════════════════════════════════
  // MOMENTS TAB
  // ═══════════════════════════════════════════════
  async function loadMoments() {
    const feed = $('moments-feed');
    if (!feed) return;
    feed.innerHTML = '<div class="social-loading">Loading...</div>';
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/moments`, { headers: h });
      const data = await res.json();
      if (data.moments?.length) {
        feed.innerHTML = data.moments.map(m => `
          <div class="moment-card">
            <div class="moment-header">
              <span class="social-avatar">${escHtml(m.avatar)}</span>
              <div>
                <div class="social-name">${escHtml(m.displayName)}</div>
                <div class="social-time">${timeAgo(m.createdAt)}</div>
              </div>
            </div>
            <div class="moment-content">${escHtml(m.content)}</div>
            <div class="moment-actions">
              <button class="moment-action-btn ${m.liked ? 'liked' : ''}" data-mid="${m.id}" data-action="like">
                ${m.liked ? '❤️' : '🤍'} ${m.likeCount || 0}
              </button>
              <button class="moment-action-btn" data-mid="${m.id}" data-action="comment">
                💬 ${m.commentCount || 0}
              </button>
              ${m.userId === auth?.currentUser?.uid ? `<button class="moment-action-btn" data-mid="${m.id}" data-action="delete">🗑️</button>` : ''}
            </div>
          </div>
        `).join('');
      } else {
        feed.innerHTML = '<div class="social-empty" data-i18n="moments_empty">No moments yet. Post something!</div>';
      }
    } catch { feed.innerHTML = '<div class="social-empty">Failed to load</div>'; }
  }

  // Post moment
  $('moments-post-btn')?.addEventListener('click', async () => {
    const input = $('moments-input');
    const text = input?.value?.trim();
    if (!text) return;
    input.value = '';
    try {
      const h = await authHeaders();
      await fetch(`${API}/api/moments`, { method: 'POST', headers: h, body: JSON.stringify({ content: text }) });
      loadMoments();
    } catch {}
  });

  // Like / Delete
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.moment-action-btn');
    if (!btn) return;
    const mid = btn.dataset.mid;
    const action = btn.dataset.action;
    if (!mid || !action) return;
    try {
      const h = await authHeaders();
      if (action === 'like') {
        await fetch(`${API}/api/moments/${mid}/like`, { method: 'POST', headers: h });
        loadMoments();
      } else if (action === 'delete') {
        if (confirm('Delete this moment?')) {
          await fetch(`${API}/api/moments/${mid}`, { method: 'DELETE', headers: h });
          loadMoments();
        }
      }
    } catch {}
  });

  // Expose openDMChat globally for match.js
  window.NYCKING_OPEN_DM = openDMChat;

  // ═══════════════════════════════════════════════
  // NAVIGATION HOOKS — load data when tab shown
  // ═══════════════════════════════════════════════
  const origShow = window.NYCKING_SHOW;
  window.NYCKING_SHOW = function (id) {
    // Stop DM polling when leaving DM
    if (id !== 'dm-screen' && currentConvId) closeDMChat();

    if (origShow) origShow(id);

    if (id === 'contacts-screen') loadContacts();
    else if (id === 'dm-screen') loadConversations();
    else if (id === 'moments-screen') loadMoments();
  };
})();
