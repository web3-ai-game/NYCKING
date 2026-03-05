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

  // ─── Toggle login/register mode ───
  toggleBtn.addEventListener('click', () => {
    isRegister = !isRegister;
    submitBtn.textContent = isRegister ? 'Register' : 'Sign In';
    toggleBtn.textContent = isRegister ? 'Have an account? Sign In' : 'No account? Register';
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
    if (!snap.exists) {
      await ref.set({
        displayName: user.displayName || user.email.split('@')[0],
        username: user.uid.slice(0, 8),
        email: user.email || '',
        avatar: '😊',
        bio: '',
        lang: localStorage.getItem('nycking_i18n') || 'en',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // Update last seen
      ref.update({ lastSeen: firebase.firestore.FieldValue.serverTimestamp() });
    }
    const profile = (await ref.get()).data();
    window.NYCKING_USER = { uid: user.uid, ...profile };
    return profile;
  }

  // ─── Auth state listener ───
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      try {
        await ensureUserProfile(user);
      } catch (err) {
        console.error('[auth] profile error:', err);
      }
      // Navigate to module screen
      if (window.NYCKING_SHOW) window.NYCKING_SHOW('module-screen');
    }
    // If no user, stay on current screen (home or auth)
  });

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
