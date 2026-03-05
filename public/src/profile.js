// ═══════════════════════════════════════════════════
// NYCKING Profile & Tab Navigation
// ═══════════════════════════════════════════════════

(function () {
  const $ = (id) => document.getElementById(id);
  const API = window.NYCKING_API_BASE || '';
  const auth = window.NYCKING_AUTH;
  const db = window.NYCKING_DB;

  const TAB_SCREENS = ['module-screen', 'dm-screen', 'contacts-screen', 'moments-screen', 'me-screen'];
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

  // Override show to manage tab bar visibility
  const originalShow = window.NYCKING_SHOW;
  window.NYCKING_SHOW = function (id) {
    if (originalShow) originalShow(id);

    // Show tab bar on "inner" screens (when logged in)
    const isInner = TAB_SCREENS.includes(id) ||
      id.startsWith('screen-') || id.startsWith('voice-') || id.startsWith('text-');
    showTabBar(isInner);

    // Update active tab
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
    // Update tab bar Me icon
    $('tab-me-icon').textContent = user.avatar || '😊';
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

  // ─── Listen for auth changes to show/hide tab bar ───
  if (auth) {
    auth.onAuthStateChanged((user) => {
      if (user) {
        // Small delay to let auth.js create profile first
        setTimeout(() => {
          showTabBar(true);
          refreshProfile();
        }, 500);
      } else {
        showTabBar(false);
      }
    });
  }
})();
