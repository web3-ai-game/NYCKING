// ═══════════════════════════════════════════════════
// NYCKING Usage Accounting — Count-based usage tracking
// Free: 1000 uses, Pro/Admin: unlimited
// ═══════════════════════════════════════════════════

(function () {
  const db = window.NYCKING_DB;
  const auth = window.NYCKING_AUTH;
  if (!db || !auth) return;

  // ─── Global usage badge (injected into DOM) ───
  const badge = document.createElement('div');
  badge.id = 'token-badge';
  badge.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,10px) + 44px);left:10px;z-index:190;background:rgba(22,22,22,.85);backdrop-filter:blur(8px);border:1px solid #333;border-radius:10px;padding:3px 8px;font-size:10px;font-weight:700;color:#f97316;display:none;cursor:pointer;';
  badge.innerHTML = '<img src="/icons/coins.png" style="width:14px;height:14px;vertical-align:middle;margin-right:3px"><span id="token-count">—</span>';
  document.body.appendChild(badge);

  let cachedUsageCount = null;
  let cachedUsageLimit = null;

  // ─── Refresh usage display ───
  async function refreshTokens() {
    const user = auth.currentUser;
    if (!user) { badge.style.display = 'none'; return; }
    try {
      const snap = await db.collection('users').doc(user.uid).get();
      if (!snap.exists) return;
      const data = snap.data();
      cachedUsageCount = data.usageCount ?? 0;
      cachedUsageLimit = data.usageLimit ?? 1000;
      const tier = data.tier || 'free';
      const el = document.getElementById('token-count');
      if (el) {
        if (tier === 'admin' || tier === 'pro' || cachedUsageLimit === -1) {
          el.textContent = '∞ Unlimited';
        } else {
          const remaining = Math.max(0, cachedUsageLimit - cachedUsageCount);
          el.textContent = remaining.toLocaleString() + ' left';
        }
      }
      badge.style.display = '';
      // Update NYCKING_USER cache
      if (window.NYCKING_USER) {
        window.NYCKING_USER.usageCount = cachedUsageCount;
        window.NYCKING_USER.usageLimit = cachedUsageLimit;
        window.NYCKING_USER.tier = tier;
      }
    } catch (err) {
      console.error('[tokens] refresh error:', err);
    }
  }

  // ─── Increment usage count after API call ───
  window.NYCKING_DEDUCT_TOKENS = async function (_tokensIn, _tokensOut) {
    const user = auth.currentUser;
    if (!user) return;

    // Check admin/pro unlimited
    const tier = window.NYCKING_USER?.tier || 'free';
    if (tier === 'admin' || tier === 'pro') return; // Unlimited: no deduction
    const limit = window.NYCKING_USER?.usageLimit ?? 1000;
    if (limit === -1) return; // Unlimited

    try {
      await db.collection('users').doc(user.uid).update({
        usageCount: firebase.firestore.FieldValue.increment(1),
      });
      // Update local cache
      if (cachedUsageCount !== null) {
        cachedUsageCount += 1;
        const remaining = Math.max(0, (cachedUsageLimit || 1000) - cachedUsageCount);
        const el = document.getElementById('token-count');
        if (el) el.textContent = remaining.toLocaleString() + ' left';
        if (window.NYCKING_USER) {
          window.NYCKING_USER.usageCount = cachedUsageCount;
        }
      }
    } catch (err) {
      console.error('[tokens] deduct error:', err);
    }
  };

  // ─── Check if user has remaining uses ───
  window.NYCKING_CHECK_TOKENS = function () {
    const tier = window.NYCKING_USER?.tier || 'free';
    if (tier === 'admin' || tier === 'pro') return true;
    const limit = window.NYCKING_USER?.usageLimit ?? 1000;
    if (limit === -1) return true;
    const count = window.NYCKING_USER?.usageCount ?? 0;
    if (count >= limit) {
      alert('Free usage exhausted (' + limit + ' translations). Upgrade to Pro for unlimited translations, or enter an activation code!');
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
      cachedUsageCount = null;
      cachedUsageLimit = null;
    }
  });

  // Click badge → navigate to Me page
  badge.addEventListener('click', () => {
    if (window.NYCKING_SHOW) window.NYCKING_SHOW('me-screen');
  });

  // Expose refresh
  window.NYCKING_REFRESH_TOKENS = refreshTokens;
})();
