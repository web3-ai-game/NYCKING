// ═══════════════════════════════════════════════════
// NYCKING Token Accounting — Global usage tracking
// ═══════════════════════════════════════════════════

(function () {
  const db = window.NYCKING_DB;
  const auth = window.NYCKING_AUTH;
  if (!db || !auth) return;

  // ─── Global token badge (injected into DOM) ───
  const badge = document.createElement('div');
  badge.id = 'token-badge';
  badge.style.cssText = 'position:fixed;top:env(safe-area-inset-top,10px);left:10px;z-index:190;background:rgba(22,22,22,.85);backdrop-filter:blur(8px);border:1px solid #333;border-radius:10px;padding:3px 8px;font-size:10px;font-weight:700;color:#f97316;display:none;cursor:pointer;';
  badge.innerHTML = '<img src="/icons/coins.png" style="width:14px;height:14px;vertical-align:middle;margin-right:3px"><span id="token-count">—</span>';
  document.body.appendChild(badge);

  let cachedBalance = null;

  // ─── Refresh token display ───
  async function refreshTokens() {
    const user = auth.currentUser;
    if (!user) { badge.style.display = 'none'; return; }
    try {
      const snap = await db.collection('users').doc(user.uid).get();
      if (!snap.exists) return;
      const data = snap.data();
      cachedBalance = data.tokenBalance ?? 10000;
      const tier = data.tier || 'free';
      const el = document.getElementById('token-count');
      if (el) el.textContent = cachedBalance.toLocaleString();
      badge.style.display = '';
      // Update NYCKING_USER cache
      if (window.NYCKING_USER) {
        window.NYCKING_USER.tokenBalance = cachedBalance;
        window.NYCKING_USER.tokenUsed = data.tokenUsed || 0;
        window.NYCKING_USER.tier = tier;
      }
    } catch (err) {
      console.error('[tokens] refresh error:', err);
    }
  }

  // ─── Deduct tokens after API call ───
  window.NYCKING_DEDUCT_TOKENS = async function (tokensIn, tokensOut) {
    const user = auth.currentUser;
    if (!user) return;
    const total = (tokensIn || 0) + (tokensOut || 0);
    if (total <= 0) return;

    // Check admin/pro unlimited
    const tier = window.NYCKING_USER?.tier || 'free';
    if (tier === 'admin') return; // Admin: no deduction

    try {
      await db.collection('users').doc(user.uid).update({
        tokenBalance: firebase.firestore.FieldValue.increment(-total),
        tokenUsed: firebase.firestore.FieldValue.increment(total),
      });
      // Update local cache
      if (cachedBalance !== null) {
        cachedBalance = Math.max(0, cachedBalance - total);
        const el = document.getElementById('token-count');
        if (el) el.textContent = cachedBalance.toLocaleString();
        if (window.NYCKING_USER) {
          window.NYCKING_USER.tokenBalance = cachedBalance;
          window.NYCKING_USER.tokenUsed = (window.NYCKING_USER.tokenUsed || 0) + total;
        }
      }
    } catch (err) {
      console.error('[tokens] deduct error:', err);
    }
  };

  // ─── Check if user has enough tokens ───
  window.NYCKING_CHECK_TOKENS = function () {
    const tier = window.NYCKING_USER?.tier || 'free';
    if (tier === 'admin' || tier === 'pro') return true;
    if (cachedBalance !== null && cachedBalance <= 0) {
      alert('Token balance exhausted. Upgrade to Pro for 100,000 tokens/month!');
      return false;
    }
    return true;
  };

  // ─── Show/hide based on screen ───
  const HIDE_ON = ['home-screen', 'auth-screen', 'screen-2048', 'screen-snake', 'screen-mole', 'screen-lb', 'voice-screen', 'text-screen'];
  function updateBadgeVisibility(screenId) {
    if (!auth.currentUser || HIDE_ON.includes(screenId)) {
      badge.style.display = 'none';
    } else {
      badge.style.display = '';
    }
  }

  // Hook into navigation
  const _origShow = window.NYCKING_SHOW;
  window.NYCKING_SHOW = function (id) {
    if (_origShow) _origShow(id);
    updateBadgeVisibility(id);
  };

  // ─── Auth state ───
  auth.onAuthStateChanged((user) => {
    if (user) {
      setTimeout(refreshTokens, 800);
    } else {
      badge.style.display = 'none';
      cachedBalance = null;
    }
  });

  // Click badge → navigate to Me page
  badge.addEventListener('click', () => {
    if (window.NYCKING_SHOW) window.NYCKING_SHOW('me-screen');
  });

  // Expose refresh
  window.NYCKING_REFRESH_TOKENS = refreshTokens;
})();
