// ═══════════════════════════════════════════════════
// NYCKING AI Coach — Conversation Helper
// ═══════════════════════════════════════════════════

(function () {
  const $ = (id) => document.getElementById(id);
  const API = window.NYCKING_API_BASE || '';

  let currentMode = 'topics';
  let currentStage = 'new';

  // ─── Tab switching ───
  document.querySelectorAll('.coach-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.coach-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMode = tab.dataset.mode;
      // Show/hide input area based on mode
      $('coach-input-area').style.display = currentMode === 'topics' ? 'none' : '';
      // Update button text
      updateButtonText();
    });
  });

  // ─── Stage switching ───
  document.querySelectorAll('.coach-stage').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.coach-stage').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentStage = btn.dataset.stage;
    });
  });

  function updateButtonText() {
    const btn = $('coach-send');
    const labels = {
      topics: '💡 Get Topics',
      polish: '✨ Polish My Message',
      reply: '🎯 Suggest Replies',
    };
    btn.textContent = labels[currentMode] || labels.topics;
  }

  // ─── Get i18n lang ───
  function getLang() {
    return localStorage.getItem('nycking_i18n') || 'en';
  }

  // ─── Send request ───
  $('coach-send').addEventListener('click', async () => {
    const btn = $('coach-send');
    const resultEl = $('coach-result');
    const inputEl = $('coach-input');

    // Validate input for polish/reply modes
    if (currentMode !== 'topics' && (!inputEl.value || !inputEl.value.trim())) {
      inputEl.focus();
      inputEl.style.borderColor = '#f97316';
      setTimeout(() => { inputEl.style.borderColor = '#333'; }, 1500);
      return;
    }

    btn.disabled = true;
    resultEl.innerHTML = '<div class="coach-loading"><span class="dot-pulse">●</span> Thinking...</div>';

    try {
      const body = {
        mode: currentMode,
        lang: getLang(),
        stage: currentStage,
      };
      if (currentMode !== 'topics') {
        body.text = inputEl.value.trim();
      }

      const res = await fetch(`${API}/api/coach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      renderResult(data.result);

      // Show cost badge
      if (data.costTHB !== undefined) {
        const costBadge = $('cost-badge');
        const costVal = $('cost-val');
        const costTokens = $('cost-tokens');
        if (costBadge && costVal && costTokens) {
          costVal.textContent = '฿' + data.costTHB.toFixed(4);
          costTokens.textContent = (data.tokensIn + data.tokensOut) + ' tokens';
          costBadge.style.display = '';
          setTimeout(() => { costBadge.style.display = 'none'; }, 5000);
        }
      }
    } catch (err) {
      resultEl.innerHTML = `<div style="color:#f87171;text-align:center;padding:16px">⚠️ ${err.message}</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  // ─── Render result ───
  function renderResult(text) {
    const resultEl = $('coach-result');
    if (!text) {
      resultEl.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:16px">No result</div>';
      return;
    }

    // Split numbered items
    const lines = text.split('\n').filter(l => l.trim());
    const items = [];
    let current = '';
    for (const line of lines) {
      if (/^\d+[\.\)]\s/.test(line.trim())) {
        if (current) items.push(current);
        current = line.trim().replace(/^\d+[\.\)]\s*/, '');
      } else {
        current += ' ' + line.trim();
      }
    }
    if (current) items.push(current);

    if (items.length > 0) {
      resultEl.innerHTML = items.map((item, i) => `
        <div class="cr-item" onclick="navigator.clipboard.writeText(this.textContent.trim()).then(()=>{this.style.color='var(--accent)';setTimeout(()=>this.style.color='',800)})" title="Tap to copy">
          <span style="color:var(--accent);font-weight:700">${i + 1}.</span> ${escapeHtml(item)}
        </div>
      `).join('');
    } else {
      resultEl.innerHTML = `<div style="padding:8px">${escapeHtml(text)}</div>`;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
