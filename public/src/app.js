/**
 * NYCKING Translator — Main App (v2)
 * Modules: Voice Translate + Text Translate
 * Languages: zh-CN, en-US, th-TH, lo-LA, my-MM
 * Features: pivot translation, context memory, scene modes
 */

const API_BASE = window.NYCKING_API_BASE || '';
const ALL_LANGS = ['zh-CN', 'en-US', 'th-TH', 'lo-LA', 'my-MM'];

// ─── Shared State ───
let totalTokensIn = 0;
let totalTokensOut = 0;
let totalCostTHB = 0;

// Shared context memory (last ~10 translations, shared across modules)
const contextMemory = [];
const MAX_CONTEXT = 10;

// ─── Global DOM ───
const $ = (id) => document.getElementById(id);
const costBadge = $('cost-badge');
const costVal = $('cost-val');
const costTokens = $('cost-tokens');

// ─── TTS Voice Preferences ───
const VOICE_PREFS = {
  'zh-CN': ['Google 普通话（中国大陆）', 'Google 中文（普通话）', 'Microsoft Xiaoxiao', 'Ting-Ting'],
  'en-US': ['Google US English', 'Microsoft Mark', 'Samantha', 'Alex'],
  'th-TH': ['Google ไทย', 'Microsoft Pattara', 'Kanya'],
  'lo-LA': ['lo-LA', 'lo_LA', 'lo'],
  'my-MM': ['my-MM', 'my_MM', 'my'],
};
let voiceCache = {};

function findBestVoice(lang) {
  if (voiceCache[lang]) return voiceCache[lang];
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  for (const pref of (VOICE_PREFS[lang] || [])) {
    const v = voices.find(v => v.name === pref || v.name.includes(pref));
    if (v) { voiceCache[lang] = v; return v; }
  }
  const exact = voices.find(v => v.lang === lang);
  if (exact) { voiceCache[lang] = exact; return exact; }
  const prefix = voices.find(v => v.lang.startsWith(lang.split('-')[0]));
  if (prefix) { voiceCache[lang] = prefix; return prefix; }
  return null;
}

function speak(text, lang, onDone) {
  if (!text || !window.speechSynthesis) { onDone?.(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.9;
  const voice = findBestVoice(lang);
  if (voice) u.voice = voice;
  u.onend = () => onDone?.();
  u.onerror = () => onDone?.();
  speechSynthesis.speak(u);
}

// ─── Translation API ───
async function translateAPI(text, sourceLang, targetLang, scene, noisyEnv) {
  const resp = await fetch(`${API_BASE}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: text.trim(),
      sourceLang,
      targetLang,
      scene,
      noisyEnv,
      context: contextMemory.slice(-MAX_CONTEXT),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();

  // Update context memory
  contextMemory.push({ source: text.trim(), target: data.translation });
  if (contextMemory.length > MAX_CONTEXT) contextMemory.shift();

  // Update cost
  totalTokensIn += data.tokensIn || 0;
  totalTokensOut += data.tokensOut || 0;
  totalCostTHB += data.costTHB || 0;
  updateCostBadge();

  return data;
}

function updateCostBadge() {
  const total = totalTokensIn + totalTokensOut;
  costBadge.style.display = total > 0 ? 'flex' : 'none';
  costVal.textContent = `฿${totalCostTHB.toFixed(4)}`;
  costTokens.textContent = `${total.toLocaleString()} tok`;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ═══════════════════════════════════════
// VOICE TRANSLATOR MODULE
// ═══════════════════════════════════════
const Voice = (() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // DOM
  const micBtn = $('v-mic-btn');
  const micLabel = $('v-mic-label');
  const srcText = $('v-source-text');
  const tgtText = $('v-target-text');
  const srcPanel = $('v-source-panel');
  const tgtPanel = $('v-target-panel');
  const srcLang = $('v-source-lang');
  const tgtLang = $('v-target-lang');
  const swapBtn = $('v-swap-btn');
  const speakBtn = $('v-speak-btn');
  const status = $('v-status');
  const autoSpeakCb = $('v-auto-speak');
  const continuousCb = $('v-continuous');
  const noisyCb = $('v-noisy');
  const histList = $('v-history-list');
  const histCount = $('v-history-count');
  const sceneBar = $('v-scene-bar');
  const textInput = $('v-text-input');
  const sendBtn = $('v-send-btn');
  const notSupported = $('v-not-supported');

  let recognition = null;
  let isListening = false;
  let isSpeaking = false;
  let isTranslating = false;
  let stoppingManually = false;
  let scene = 'travel';
  const history = [];

  function setStatus(msg, type) {
    status.textContent = msg;
    status.className = `status-bar ${type || ''}`;
  }

  function setSrc(text, interim) {
    srcText.textContent = text;
    srcText.className = interim ? 'panel-text interim' : 'panel-text';
  }

  function setTgt(text, loading) {
    tgtText.textContent = text;
    tgtText.className = loading ? 'panel-text interim' : 'panel-text';
  }

  function addHistory(src, tgt, pivot) {
    history.unshift({ src, tgt, pivot, time: Date.now() });
    if (history.length > 20) history.pop();
    histCount.textContent = history.length ? `(${history.length})` : '';
    histList.innerHTML = history.map(h =>
      `<div class="history-item">
        <div class="history-source">${escHtml(h.src)}${h.pivot ? ' <span class="pivot-badge">via EN</span>' : ''}</div>
        <div class="history-target">${escHtml(h.tgt)}</div>
      </div>`
    ).join('');
  }

  function initRecognition() {
    if (!SpeechRecognition) return null;
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      isListening = true;
      micBtn.classList.add('listening');
      srcPanel.classList.add('active');
      micLabel.textContent = '🔴 Listening... (tap to stop)';
      setStatus('🎙️ Speak now...', 'listening');
    };

    rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      if (interim) setSrc(interim, true);
      if (final) { setSrc(final, false); doTranslate(final); }
    };

    rec.onerror = (e) => {
      isListening = false;
      micBtn.classList.remove('listening');
      srcPanel.classList.remove('active');
      if (e.error === 'no-speech') setStatus('No speech detected', 'warning');
      else if (e.error === 'not-allowed') setStatus('🚫 Mic permission denied', 'error');
      else if (e.error !== 'aborted') setStatus(`Speech error: ${e.error}`, 'error');
      micLabel.textContent = 'Tap to speak';
    };

    rec.onend = () => {
      isListening = false;
      micBtn.classList.remove('listening');
      srcPanel.classList.remove('active');
      if (!stoppingManually && continuousCb.checked && !isTranslating && !isSpeaking) {
        setTimeout(() => startListening(), 800);
      } else if (!isTranslating) {
        micLabel.textContent = 'Tap to speak';
      }
    };

    return rec;
  }

  function startListening() {
    if (isListening || isSpeaking) return;
    if (!recognition) recognition = initRecognition();
    if (!recognition) return;
    stoppingManually = false;
    recognition.lang = srcLang.value;
    try { recognition.start(); } catch (e) {}
  }

  function stopListening() {
    if (!isListening || !recognition) return;
    stoppingManually = true;
    try { recognition.stop(); } catch (e) {}
    isListening = false;
    micBtn.classList.remove('listening');
    micLabel.textContent = 'Tap to speak';
  }

  async function doTranslate(text) {
    if (!text.trim()) return;
    isTranslating = true;
    setStatus('⏳ Translating...', 'info');
    setTgt('...', true);
    micLabel.textContent = 'Translating...';

    try {
      const data = await translateAPI(text, srcLang.value, tgtLang.value, scene, noisyCb.checked);
      setTgt(data.translation, false);
      const pivotNote = data.pivotUsed ? ' (via EN)' : '';
      setStatus(`✅ Done ${data.latencyMs}ms${pivotNote}`, 'success');
      addHistory(text, data.translation, data.pivotUsed);

      if (autoSpeakCb.checked && data.translation) {
        isSpeaking = true;
        tgtPanel.classList.add('active');
        micLabel.textContent = '🔊 Speaking...';
        speak(data.translation, tgtLang.value, () => {
          isSpeaking = false;
          tgtPanel.classList.remove('active');
          micLabel.textContent = 'Tap to speak';
          if (continuousCb.checked) setTimeout(() => startListening(), 500);
        });
      } else {
        micLabel.textContent = 'Tap to speak';
        if (continuousCb.checked) setTimeout(() => startListening(), 500);
      }
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'error');
      setTgt('Translation failed', false);
      micLabel.textContent = 'Tap to retry';
    } finally {
      isTranslating = false;
    }
  }

  function init() {
    if (!SpeechRecognition && notSupported) notSupported.style.display = 'block';
    if (!SpeechRecognition && micBtn) micBtn.disabled = true;

    micBtn.addEventListener('click', () => {
      if (isSpeaking) { speechSynthesis.cancel(); isSpeaking = false; return; }
      isListening ? stopListening() : startListening();
    });

    swapBtn.addEventListener('click', () => {
      const s = srcLang.value, t = tgtLang.value;
      srcLang.value = t; tgtLang.value = s;
    });

    srcLang.addEventListener('change', () => {
      if (srcLang.value === tgtLang.value) {
        tgtLang.value = ALL_LANGS.find(l => l !== srcLang.value) || 'en-US';
      }
    });
    tgtLang.addEventListener('change', () => {
      if (tgtLang.value === srcLang.value) {
        srcLang.value = ALL_LANGS.find(l => l !== tgtLang.value) || 'zh-CN';
      }
    });

    speakBtn.addEventListener('click', () => {
      const t = tgtText.textContent;
      if (t && !tgtText.classList.contains('placeholder')) speak(t, tgtLang.value, null);
    });

    sendBtn.addEventListener('click', () => {
      const t = textInput.value.trim();
      if (t && !isTranslating) { setSrc(t, false); textInput.value = ''; doTranslate(t); }
    });
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    sceneBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-scene]');
      if (!btn) return;
      scene = btn.dataset.scene;
      sceneBar.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });

    recognition = initRecognition();
  }

  return { init };
})();

// ═══════════════════════════════════════
// TEXT TRANSLATOR MODULE
// ═══════════════════════════════════════
const TextMod = (() => {
  const srcLang = $('t-source-lang');
  const tgtLang = $('t-target-lang');
  const swapBtn = $('t-swap-btn');
  const input = $('t-input');
  const clearBtn = $('t-clear-btn');
  const translateBtn = $('t-translate-btn');
  const tgtText = $('t-target-text');
  const tgtPanel = $('t-target-panel');
  const speakBtn = $('t-speak-btn');
  const status = $('t-status');
  const autoSpeakCb = $('t-auto-speak');
  const noisyCb = $('t-noisy');
  const sceneBar = $('t-scene-bar');
  const histList = $('t-history-list');
  const histCount = $('t-history-count');

  let scene = 'travel';
  let isTranslating = false;
  const history = [];

  function setStatus(msg, type) {
    status.textContent = msg;
    status.className = `status-bar ${type || ''}`;
  }

  function setTgt(text, loading) {
    tgtText.textContent = text;
    tgtText.className = loading ? 'panel-text interim' : 'panel-text';
  }

  function addHistory(src, tgt, pivot) {
    history.unshift({ src, tgt, pivot, time: Date.now() });
    if (history.length > 30) history.pop();
    histCount.textContent = history.length ? `(${history.length})` : '';
    histList.innerHTML = history.map(h =>
      `<div class="history-item">
        <div class="history-source">${escHtml(h.src)}${h.pivot ? ' <span class="pivot-badge">via EN</span>' : ''}</div>
        <div class="history-target">${escHtml(h.tgt)}</div>
      </div>`
    ).join('');
  }

  async function doTranslate() {
    const text = input.value.trim();
    if (!text || isTranslating) return;
    isTranslating = true;
    translateBtn.disabled = true;
    setStatus('⏳ Translating...', 'info');
    setTgt('...', true);

    try {
      const data = await translateAPI(text, srcLang.value, tgtLang.value, scene, noisyCb.checked);
      setTgt(data.translation, false);
      const pivotNote = data.pivotUsed ? ' (via EN)' : '';
      setStatus(`✅ Done ${data.latencyMs}ms${pivotNote}`, 'success');
      addHistory(text, data.translation, data.pivotUsed);

      if (autoSpeakCb.checked && data.translation) {
        speak(data.translation, tgtLang.value, null);
      }
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'error');
      setTgt('Translation failed', false);
    } finally {
      isTranslating = false;
      translateBtn.disabled = false;
    }
  }

  function init() {
    translateBtn.addEventListener('click', doTranslate);
    input.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) && !e.isComposing) {
        e.preventDefault();
        doTranslate();
      }
    });

    clearBtn.addEventListener('click', () => { input.value = ''; input.focus(); });

    swapBtn.addEventListener('click', () => {
      const s = srcLang.value, t = tgtLang.value;
      srcLang.value = t; tgtLang.value = s;
    });

    srcLang.addEventListener('change', () => {
      if (srcLang.value === tgtLang.value) tgtLang.value = ALL_LANGS.find(l => l !== srcLang.value) || 'en-US';
    });
    tgtLang.addEventListener('change', () => {
      if (tgtLang.value === srcLang.value) srcLang.value = ALL_LANGS.find(l => l !== tgtLang.value) || 'zh-CN';
    });

    speakBtn.addEventListener('click', () => {
      const t = tgtText.textContent;
      if (t && !tgtText.classList.contains('placeholder')) speak(t, tgtLang.value, null);
    });

    sceneBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-scene]');
      if (!btn) return;
      scene = btn.dataset.scene;
      sceneBar.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }

  return { init };
})();

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  Voice.init();
  TextMod.init();

  // Load TTS voices
  if (window.speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => {
      voiceCache = {};
      console.log('[tts] voices loaded:', speechSynthesis.getVoices().length);
    };
  }

  console.log('[app] NYCKING v2 ready — Voice + Text modules');
});

// Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
