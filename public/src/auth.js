// ═══════════════════════════════════════════════════
// NYCKING Auth — Firebase Authentication + User Profile
// ═══════════════════════════════════════════════════

(function () {
  const auth = window.NYCKING_AUTH;
  const db = window.NYCKING_DB;
  if (!auth || !db) { console.error('[auth] Firebase not initialized'); return; }

  const $ = (id) => document.getElementById(id);

  // Elements
  const emailInput = $('auth-email');
  const passInput = $('auth-password');
  const submitBtn = $('auth-submit');
  const googleBtn = $('auth-google');
  const toggleBtn = $('auth-toggle');
  const errorEl = $('auth-error');
  const backBtn = $('auth-back');

  let isRegister = false;

  // ─── Toggle login/register mode (i18n aware) ───
  function getI18n(key, fallback) {
    try {
      const lang = localStorage.getItem('nycking_i18n') || 'en';
      const el = document.querySelector(`[data-i18n="${key}"]`);
      return el?.textContent || fallback;
    } catch { return fallback; }
  }
  toggleBtn.addEventListener('click', () => {
    isRegister = !isRegister;
    submitBtn.textContent = isRegister ? getI18n('auth_register', 'Register') : getI18n('auth_login', 'Sign In');
    toggleBtn.textContent = isRegister ? getI18n('auth_have_account', 'Have an account? Sign In') : getI18n('auth_no_account', 'No account? Register');
    passInput.autocomplete = isRegister ? 'new-password' : 'current-password';
    errorEl.textContent = '';
  });

  // ─── Back to home ───
  backBtn.addEventListener('click', () => {
    if (window.NYCKING_SHOW) window.NYCKING_SHOW('home-screen');
  });

  // ─── Email/Password submit ───
  submitBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const pass = passInput.value;
    if (!email || !pass) {
      errorEl.textContent = 'Please enter email and password';
      return;
    }
    if (pass.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters';
      return;
    }
    submitBtn.disabled = true;
    errorEl.textContent = '';
    try {
      if (isRegister) {
        await auth.createUserWithEmailAndPassword(email, pass);
      } else {
        await auth.signInWithEmailAndPassword(email, pass);
      }
      // onAuthStateChanged will handle navigation
    } catch (err) {
      const msg = {
        'auth/email-already-in-use': 'Email already registered',
        'auth/invalid-email': 'Invalid email format',
        'auth/wrong-password': 'Wrong password',
        'auth/user-not-found': 'No account with this email',
        'auth/invalid-credential': 'Invalid email or password',
        'auth/too-many-requests': 'Too many attempts. Try later',
        'auth/weak-password': 'Password too weak (min 6 chars)',
      };
      errorEl.textContent = msg[err.code] || err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Enter key submit
  passInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitBtn.click();
  });

  // ─── Google Sign In ───
  googleBtn.addEventListener('click', async () => {
    googleBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        errorEl.textContent = err.message;
      }
    } finally {
      googleBtn.disabled = false;
    }
  });

  // ─── Ensure user profile exists in Firestore ───
  async function ensureUserProfile(user) {
    const ref = db.collection('users').doc(user.uid);
    const snap = await ref.get();
    let isNew = false;
    if (!snap.exists) {
      isNew = true;
      await ref.set({
        displayName: user.displayName || user.email.split('@')[0],
        username: user.uid.slice(0, 8),
        email: user.email || '',
        avatar: '😊',
        bio: '',
        lang: localStorage.getItem('nycking_i18n') || 'en',
        tier: 'free',
        tokenBalance: 10000,
        tokenUsed: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      ref.update({ lastSeen: firebase.firestore.FieldValue.serverTimestamp() });
    }
    const profile = (await ref.get()).data();
    window.NYCKING_USER = { uid: user.uid, ...profile };
    return { profile, isNew };
  }

  // ─── Auth state listener ───
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      let isNew = false;
      try {
        const result = await ensureUserProfile(user);
        isNew = result.isNew;
      } catch (err) {
        console.error('[auth] profile error:', err);
      }
      // New user → profile setup, existing → tools
      if (window.NYCKING_SHOW) {
        window.NYCKING_SHOW(isNew ? 'me-screen' : 'module-screen');
      }
      // Pro/Admin celebration effect
      const tier = window.NYCKING_USER?.tier;
      if (!isNew && (tier === 'pro' || tier === 'admin')) {
        showProCelebration(tier);
      }
    }
  });

  // ─── Pro celebration effect (confetti + welcome) ───
  function showProCelebration(tier) {
    const container = document.getElementById('confetti-container');
    if (!container) return;
    // Spawn confetti pieces
    const colors = ['#f97316','#fb923c','#fbbf24','#22c55e','#3b82f6','#a855f7','#ef4444','#ec4899'];
    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 2 + 's';
      piece.style.animationDuration = (2 + Math.random() * 2) + 's';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      piece.style.width = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      container.appendChild(piece);
    }
    // Welcome card
    const welcome = document.createElement('div');
    welcome.className = 'pro-welcome';
    welcome.innerHTML = `
      <div class="pw-icon">${tier === 'admin' ? '🛡️' : '👑'}</div>
      <div class="pw-title">Welcome back, ${tier.toUpperCase()}!</div>
      <div class="pw-sub">${tier === 'admin' ? 'Admin panel ready. Full control activated.' : 'Enjoy unlimited translations & premium features!'}</div>
      <button class="pw-btn" id="pw-dismiss">Let\'s Go!</button>
    `;
    document.body.appendChild(welcome);
    // Dismiss
    document.getElementById('pw-dismiss').addEventListener('click', () => {
      welcome.remove();
      container.innerHTML = '';
    });
    // Auto-dismiss after 5s
    setTimeout(() => {
      welcome.remove();
      container.innerHTML = '';
    }, 5000);
  }

  // ─── Sign out (called from settings) ───
  window.NYCKING_SIGN_OUT = async function () {
    try {
      await auth.signOut();
      window.NYCKING_USER = null;
      if (window.NYCKING_SHOW) window.NYCKING_SHOW('home-screen');
    } catch (err) {
      console.error('[auth] sign out error:', err);
    }
  };

  // ─── Get current user (for other modules) ───
  window.NYCKING_GET_USER = function () {
    return window.NYCKING_USER || null;
  };
})();
