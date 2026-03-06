// ═══════════════════════════════════════════════════
// NYCKING Ranking — Token Consumption Leaderboard
// ═══════════════════════════════════════════════════

(function () {
  const $ = (id) => document.getElementById(id);
  const API = window.NYCKING_API_BASE || '';
  const auth = window.NYCKING_AUTH;

  let loaded = false;

  async function loadRanking() {
    const list = $('ranking-list');
    if (!list) return;
    list.innerHTML = '<div class="social-loading">Loading...</div>';

    try {
      const res = await fetch(`${API}/api/users/ranking`);
      const data = await res.json();

      if (data.ranking?.length) {
        const myUid = auth?.currentUser?.uid;
        const medals = ['🥇', '🥈', '🥉'];
        list.innerHTML = data.ranking.map((u, i) => {
          const isMe = u.uid === myUid;
          const medal = medals[i] || (i + 1);
          const tierColor = u.tier === 'pro' ? 'var(--accent)' : u.tier === 'admin' ? 'var(--success)' : 'var(--text-dim)';
          return `
            <div class="rank-row ${isMe ? 'rank-me' : ''}" data-uid="${u.uid}">
              <span class="rank-pos">${medal}</span>
              <span class="social-avatar">${escHtml(u.avatar)}</span>
              <div class="rank-info">
                <div class="rank-name">${escHtml(u.displayName)}
                  ${u.tier !== 'free' ? `<span style="font-size:9px;color:${tierColor};font-weight:700;margin-left:4px">${u.tier.toUpperCase()}</span>` : ''}
                </div>
                <div class="rank-sub">@${escHtml(u.username)}</div>
              </div>
              <div class="rank-tokens">
                <div class="rank-token-val">⚡ ${u.tokenUsed.toLocaleString()}</div>
                <div class="rank-token-label" data-i18n="ranking_used">used</div>
              </div>
            </div>
          `;
        }).join('');
        loaded = true;
      } else {
        list.innerHTML = '<div class="social-empty" data-i18n="ranking_empty">No activity yet. Start translating!</div>';
      }
    } catch (err) {
      console.error('[ranking] load error:', err);
      list.innerHTML = '<div class="social-empty">Failed to load ranking</div>';
    }
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // Click rank row → view user profile
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.rank-row');
    if (!row) return;
    const uid = row.dataset.uid;
    if (uid && window.NYCKING_VIEW_PROFILE) {
      window.NYCKING_VIEW_PROFILE(uid);
    }
  });

  // Hook into navigation
  const origShow = window.NYCKING_SHOW;
  window.NYCKING_SHOW = function (id) {
    if (origShow) origShow(id);
    if (id === 'ranking-screen') loadRanking();
  };
})();
