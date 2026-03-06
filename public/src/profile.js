// ═══════════════════════════════════════════════════
// NYCKING Profile & Tab Navigation
// ═══════════════════════════════════════════════════

(function () {
  const $ = (id) => document.getElementById(id);
  const API = window.NYCKING_API_BASE || '';
  const auth = window.NYCKING_AUTH;
  const db = window.NYCKING_DB;

  const TAB_SCREENS = ['module-screen', 'ranking-screen', 'moments-screen', 'messages-screen', 'me-screen'];
  const tabBar = $('tab-bar');

  // ─── Tab bar logic ───
  tabBar.addEventListener('click', (e) => {
    const item = e.target.closest('.tab-item');
    if (!item) return;
    const target = item.dataset.tab;
    if (!target) return;

    // Update active tab
    tabBar.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    item.classList.add('active');

    // Show target screen
    if (window.NYCKING_SHOW) window.NYCKING_SHOW(target);

    // Special: reset chat when entering chat tab
    if (target === 'chat-screen' && window.NYCKING_CHAT_RESET) {
      window.NYCKING_CHAT_RESET();
    }
  });

  // ─── Show/hide tab bar based on auth ───
  function showTabBar(visible) {
    tabBar.classList.toggle('show', visible);
  }

  // Hook into navigation for profile refresh + tab active highlight
  const originalShow = window.NYCKING_SHOW;
  window.NYCKING_SHOW = function (id) {
    if (originalShow) originalShow(id);

    // Update active tab highlight
    if (TAB_SCREENS.includes(id)) {
      tabBar.querySelectorAll('.tab-item').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === id);
      });
    }

    // Refresh Me page when shown
    if (id === 'me-screen') refreshProfile();
  };

  // ─── Refresh profile UI ───
  function refreshProfile() {
    const user = window.NYCKING_USER;
    if (!user) return;
    $('me-avatar').textContent = user.avatar || '😊';
    $('me-name').textContent = user.displayName || 'User';
    $('me-username').textContent = '@' + (user.username || '—');
    $('me-uid').textContent = 'UID: ' + (user.uid || '—');
    $('me-name-val').textContent = user.displayName || '—';
    $('me-uname-val').textContent = user.username || '—';
    $('me-avatar-val').textContent = user.avatar || '😊';
    $('me-lang-val').textContent = (localStorage.getItem('nycking_i18n') || 'en').toUpperCase();
    // Tier + Usage count
    const tier = (user.tier || 'free').toUpperCase();
    const tierBadge = $('me-tier-badge');
    if (tierBadge) {
      tierBadge.textContent = tier;
      tierBadge.style.borderColor = tier === 'PRO' ? 'var(--accent)' : tier === 'ADMIN' ? 'var(--success)' : '#333';
      tierBadge.style.color = tier === 'PRO' ? 'var(--accent)' : tier === 'ADMIN' ? 'var(--success)' : 'var(--text-dim)';
    }
    const tokenBal = $('me-token-bal');
    if (tokenBal) {
      const usageCount = user.usageCount ?? 0;
      const usageLimit = user.usageLimit ?? 1000;
      if (tier === 'ADMIN' || tier === 'PRO' || usageLimit === -1) {
        tokenBal.textContent = '∞ Unlimited';
      } else {
        tokenBal.textContent = Math.max(0, usageLimit - usageCount).toLocaleString();
      }
    }
    // Update tab bar Me icon
    $('tab-me-icon').textContent = user.avatar || '😊';
    // Admin panel visibility
    const adminEntry = $('me-go-admin');
    if (adminEntry) adminEntry.style.display = (user.tier === 'admin') ? '' : 'none';
    // Invite code display
    const inviteCodeEl = $('my-invite-code');
    if (inviteCodeEl) inviteCodeEl.textContent = user.inviteCode || '—';
    const inviteCountEl = $('invite-count');
    if (inviteCountEl) inviteCountEl.textContent = user.inviteCount || 0;
  }

  // ─── Admin panel ───
  const adminBtn = $('me-go-admin');
  if (adminBtn) adminBtn.addEventListener('click', () => {
    if (window.NYCKING_SHOW) window.NYCKING_SHOW('admin-screen');
    loadAdmin();
  });
  const adminBack = $('admin-back');
  if (adminBack) adminBack.addEventListener('click', () => {
    if (window.NYCKING_SHOW) window.NYCKING_SHOW('me-screen');
  });

  async function loadAdmin() {
    try {
      const user = auth?.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const h = { 'Authorization': 'Bearer ' + token };

      // Stats
      const statsRes = await fetch((window.NYCKING_API_BASE || '') + '/api/admin/stats', { headers: h });
      const stats = await statsRes.json();
      const statsEl = $('admin-stats');
      if (statsEl && !stats.error) {
        statsEl.innerHTML = [
          { n: stats.totalUsers, l: 'Users' },
          { n: stats.proUsers, l: 'Pro' },
          { n: (stats.totalUsageCount || 0).toLocaleString(), l: 'Total Uses' },
        ].map(s => `<div style="background:var(--surface);border:1px solid #222;border-radius:12px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:var(--accent)">${s.n}</div><div style="font-size:10px;color:var(--text-dim)">${s.l}</div></div>`).join('');
      }

      // Users with tier toggle
      const usersRes = await fetch((window.NYCKING_API_BASE || '') + '/api/admin/users', { headers: h });
      const data = await usersRes.json();
      const usersEl = $('admin-users');
      if (usersEl && data.users) {
        usersEl.innerHTML = data.users.map(u => {
          const tierClass = u.tier === 'admin' ? 'admin-tier' : (u.tier || 'free');
          const nextTier = u.tier === 'free' ? 'pro' : 'free';
          const isAdmin = u.tier === 'admin';
          return `
            <div class="admin-user-row">
              <span class="au-avatar">${u.avatar || '😊'}</span>
              <div class="au-info">
                <div class="au-name">${u.displayName || 'User'}</div>
                <div class="au-sub">@${u.username || '—'} · ⚡${u.usageLimit === -1 ? '∞' : ((u.usageLimit||1000) - (u.usageCount||0))} uses left</div>
              </div>
              ${isAdmin ? `<span class="au-tier admin-tier">ADMIN</span>` : `<button class="au-tier ${tierClass}" data-uid="${u.uid}" data-next="${nextTier}">${(u.tier||'free').toUpperCase()}</button>`}
            </div>
          `;
        }).join('');

        // Tier toggle click handler
        usersEl.querySelectorAll('.au-tier[data-uid]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const uid = btn.dataset.uid;
            const next = btn.dataset.next;
            if (!confirm(`Set user to ${next.toUpperCase()}?`)) return;
            btn.disabled = true;
            try {
              await fetch((window.NYCKING_API_BASE || '') + '/api/admin/set-tier', {
                method: 'POST',
                headers: { ...h, 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid, tier: next })
              });
              loadAdmin();
            } catch (e) {
              alert('Failed: ' + e.message);
            } finally {
              btn.disabled = false;
            }
          });
        });
      }
    } catch (err) {
      console.error('[admin] load error:', err);
    }
  }

  // ─── Activation Code System ───
  const activateBtn = $('activate-btn');
  const activationInput = $('activation-code-input');
  const activationMsg = $('activation-msg');

  if (activateBtn) activateBtn.addEventListener('click', async () => {
    const code = activationInput?.value?.trim()?.toUpperCase();
    if (!code) { showMsg(activationMsg, 'Please enter an activation code', 'var(--error)'); return; }
    if (!auth?.currentUser) { showMsg(activationMsg, 'Please sign in first', 'var(--error)'); return; }

    activateBtn.disabled = true;
    try {
      const token = await auth.currentUser.getIdToken();
      const resp = await fetch((window.NYCKING_API_BASE || '') + '/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ code }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        showMsg(activationMsg, '✅ Activated! You now have Pro access for 30 days.', 'var(--success)');
        activationInput.value = '';
        // Refresh user profile
        const snap = await db.collection('users').doc(auth.currentUser.uid).get();
        if (snap.exists) {
          Object.assign(window.NYCKING_USER, snap.data());
          refreshProfile();
          if (window.NYCKING_REFRESH_TOKENS) window.NYCKING_REFRESH_TOKENS();
        }
      } else {
        showMsg(activationMsg, '❌ ' + (data.error || 'Invalid activation code'), 'var(--error)');
      }
    } catch (err) {
      showMsg(activationMsg, '❌ Network error: ' + err.message, 'var(--error)');
    } finally {
      activateBtn.disabled = false;
    }
  });

  // ─── Invite System ───
  const copyInviteBtn = $('copy-invite-btn');
  const applyInviteBtn = $('apply-invite-btn');
  const inviteInput = $('invite-code-input');
  const inviteMsg = $('invite-msg');

  if (copyInviteBtn) copyInviteBtn.addEventListener('click', () => {
    const code = window.NYCKING_USER?.inviteCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      copyInviteBtn.textContent = 'Copied!';
      setTimeout(() => { copyInviteBtn.textContent = 'Copy'; }, 2000);
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copyInviteBtn.textContent = 'Copied!';
      setTimeout(() => { copyInviteBtn.textContent = 'Copy'; }, 2000);
    });
  });

  if (applyInviteBtn) applyInviteBtn.addEventListener('click', async () => {
    const code = inviteInput?.value?.trim()?.toUpperCase();
    if (!code) { showMsg(inviteMsg, 'Please enter an invite code', 'var(--error)'); return; }
    if (!auth?.currentUser) { showMsg(inviteMsg, 'Please sign in first', 'var(--error)'); return; }

    applyInviteBtn.disabled = true;
    try {
      const token = await auth.currentUser.getIdToken();
      const resp = await fetch((window.NYCKING_API_BASE || '') + '/api/apply-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ code }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        showMsg(inviteMsg, '✅ Invite applied! You got +3000 free translations.', 'var(--success)');
        inviteInput.value = '';
        // Refresh
        const snap = await db.collection('users').doc(auth.currentUser.uid).get();
        if (snap.exists) {
          Object.assign(window.NYCKING_USER, snap.data());
          refreshProfile();
          if (window.NYCKING_REFRESH_TOKENS) window.NYCKING_REFRESH_TOKENS();
        }
      } else {
        showMsg(inviteMsg, '❌ ' + (data.error || 'Invalid invite code'), 'var(--error)');
      }
    } catch (err) {
      showMsg(inviteMsg, '❌ Network error: ' + err.message, 'var(--error)');
    } finally {
      applyInviteBtn.disabled = false;
    }
  });

  function showMsg(el, text, color) {
    if (!el) return;
    el.textContent = text;
    el.style.color = color || 'var(--text-dim)';
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  }

  // ─── Sign out ───
  $('me-logout').addEventListener('click', () => {
    if (confirm('Sign out?')) {
      if (window.NYCKING_SIGN_OUT) window.NYCKING_SIGN_OUT();
      showTabBar(false);
    }
  });

  // ─── Edit Profile Modal ───
  const modal = $('edit-modal');
  const modalTitle = $('edit-modal-title');
  const modalBody = $('edit-modal-body');
  const saveBtn = $('edit-save');
  const cancelBtn = $('edit-cancel');
  let currentEdit = null;

  function openModal(title, bodyHTML) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHTML;
    modal.classList.add('show');
  }
  function closeModal() {
    modal.classList.remove('show');
    currentEdit = null;
  }
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // Edit Display Name
  $('me-edit-name').addEventListener('click', () => {
    const user = window.NYCKING_USER || {};
    currentEdit = 'displayName';
    openModal('Display Name', `<input class="auth-input" id="edit-input" value="${user.displayName || ''}" maxlength="30" placeholder="Your name...">`);
    setTimeout(() => $('edit-input')?.focus(), 100);
  });

  // Edit Username
  $('me-edit-username').addEventListener('click', () => {
    const user = window.NYCKING_USER || {};
    currentEdit = 'username';
    openModal('Username', `<input class="auth-input" id="edit-input" value="${user.username || ''}" maxlength="20" placeholder="username (a-z, 0-9, _)" style="text-transform:lowercase">`);
    setTimeout(() => $('edit-input')?.focus(), 100);
  });

  // Edit Avatar
  const AVATARS = ['😊','😎','🥰','😤','🤗','😂','🐶','🐱','🐼','🦊','🐸','🐵','🌟','🔥','💎','🎯','🎨','🎵'];
  $('me-edit-avatar').addEventListener('click', () => {
    const user = window.NYCKING_USER || {};
    currentEdit = 'avatar';
    const grid = AVATARS.map(a =>
      `<span class="${a === user.avatar ? 'selected' : ''}" data-av="${a}">${a}</span>`
    ).join('');
    openModal('Avatar', `<div class="avatar-grid" id="avatar-grid">${grid}</div>`);
    setTimeout(() => {
      $('avatar-grid')?.addEventListener('click', (e) => {
        const span = e.target.closest('[data-av]');
        if (!span) return;
        $('avatar-grid').querySelectorAll('span').forEach(s => s.classList.remove('selected'));
        span.classList.add('selected');
      });
    }, 50);
  });

  // Edit Language
  $('me-edit-lang').addEventListener('click', () => {
    currentEdit = 'lang';
    const current = localStorage.getItem('nycking_i18n') || 'en';
    const opts = [
      { k: 'en', label: '🇺🇸 English' },
      { k: 'zh', label: '🇨🇳 中文' },
      { k: 'th', label: '🇹🇭 ไทย' },
      { k: 'my', label: '🇲🇲 မြန်မာ' },
    ];
    const html = opts.map(o =>
      `<div class="me-row" data-lang-pick="${o.k}" style="margin-bottom:6px;${o.k === current ? 'border-color:var(--accent)' : ''}">
        <span class="me-row-label">${o.label}</span>
        ${o.k === current ? '<span style="color:var(--accent)">✓</span>' : ''}
      </div>`
    ).join('');
    openModal('Language', html);
    setTimeout(() => {
      modalBody.addEventListener('click', (e) => {
        const row = e.target.closest('[data-lang-pick]');
        if (!row) return;
        const lang = row.dataset.langPick;
        localStorage.setItem('nycking_i18n', lang);
        // Trigger i18n apply
        document.querySelectorAll('.i18n-opt').forEach(o => {
          if (o.dataset.lang === lang) o.click();
        });
        closeModal();
        refreshProfile();
      });
    }, 50);
  });

  // Save handler
  saveBtn.addEventListener('click', async () => {
    if (!currentEdit || !auth?.currentUser) return;
    saveBtn.disabled = true;

    try {
      const updates = {};

      if (currentEdit === 'displayName') {
        const val = $('edit-input')?.value?.trim();
        if (!val) { saveBtn.disabled = false; return; }
        updates.displayName = val;
      } else if (currentEdit === 'username') {
        const val = $('edit-input')?.value?.trim()?.toLowerCase();
        if (!val || val.length < 3) { alert('Username must be 3+ characters'); saveBtn.disabled = false; return; }
        updates.username = val;
      } else if (currentEdit === 'avatar') {
        const sel = modalBody.querySelector('.avatar-grid .selected');
        if (!sel) { saveBtn.disabled = false; return; }
        updates.avatar = sel.dataset.av;
      } else if (currentEdit === 'lang') {
        closeModal(); saveBtn.disabled = false; return;
      }

      // Save to Firestore directly (client SDK)
      const uid = auth.currentUser.uid;
      await db.collection('users').doc(uid).update(updates);

      // Update local cache
      Object.assign(window.NYCKING_USER, updates);
      refreshProfile();
      closeModal();
    } catch (err) {
      alert(err.message || 'Failed to save');
    } finally {
      saveBtn.disabled = false;
    }
  });

  // ─── Listen for auth changes ───
  if (auth) {
    auth.onAuthStateChanged((user) => {
      if (user) {
        setTimeout(refreshProfile, 600);
      }
    });
  }
})();
