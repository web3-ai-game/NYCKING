/**
 * NYCKING Voice Translator — Main App
 * Architecture: Web Speech API (STT) → Gemini (Translate) → SpeechSynthesis (TTS)
 * Languages: Chinese(Simplified) ↔ Thai ↔ English ↔ Lao
 * Scenes: travel / romance / business
 */

const API_BASE = window.NYCKING_API_BASE || '';
const ALL_LANGS = ['zh-CN', 'en-US', 'th-TH', 'lo-LA'];

// ─── State ───
let isListening = false;
let isSpeaking = false;
let isTranslating = false;
let recognition = null;
let continuous = false;
let autoSpeak = true;
let noisyEnv = false;
let currentScene = 'travel';
let stoppingManually = false;
const history = [];

// Token cost tracking (session total)
let totalTokensIn = 0;
let totalTokensOut = 0;
let totalCostTHB = 0;

// ─── DOM refs ───
const $ = (id) => document.getElementById(id);
const micBtn = $('mic-btn');
const micLabel = $('mic-label');
const sourceText = $('source-text');
const targetText = $('target-text');
const sourcePanel = $('source-panel');
const targetPanel = $('target-panel');
const sourceLangSel = $('source-lang');
const targetLangSel = $('target-lang');
const swapBtn = $('swap-btn');
const speakBtn = $('speak-btn');
const statusBar = $('status');
const autoSpeakCb = $('auto-speak');
const continuousCb = $('continuous-mode');
const noisyEnvCb = $('noisy-env');
const historyList = $('history-list');
const historyCount = $('history-count');
const notSupported = $('not-supported');
const sceneBar = $('scene-bar');
const costBadge = $('cost-badge');
const costVal = $('cost-val');
const costTokens = $('cost-tokens');

// ─── TTS Voice Map ───
// Lock to official standard voices per language
const VOICE_PREFERENCES = {
  'zh-CN': [
    'Google 普通话（中国大陆）', 'Google 中文（普通话）',
    'Microsoft Xiaoxiao', 'Ting-Ting',
    'zh-CN', 'zh_CN',
  ],
  'en-US': [
    'Google US English', 'Microsoft Mark',
    'Samantha', 'Alex',
    'en-US', 'en_US',
  ],
  'th-TH': [
    'Google ไทย', 'Microsoft Pattara',
    'Kanya', 'Niwat',
    'th-TH', 'th_TH',
  ],
  'lo-LA': [
    'lo-LA', 'lo_LA', 'lo',
  ],
};

let voiceCache = {};

function findBestVoice(lang) {
  if (voiceCache[lang]) return voiceCache[lang];

  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;

  const prefs = VOICE_PREFERENCES[lang] || [];

  // Try exact name match from preference list
  for (const pref of prefs) {
    const v = voices.find(v => v.name === pref || v.name.includes(pref));
    if (v) { voiceCache[lang] = v; return v; }
  }

  // Try exact lang match
  const exactLang = voices.find(v => v.lang === lang);
  if (exactLang) { voiceCache[lang] = exactLang; return exactLang; }

  // Try lang prefix match
  const langPrefix = lang.split('-')[0];
  const prefixMatch = voices.find(v => v.lang.startsWith(langPrefix));
  if (prefixMatch) { voiceCache[lang] = prefixMatch; return prefixMatch; }

  return null;
}

// ─── Check browser support ───
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) {
  if (notSupported) notSupported.style.display = 'block';
  if (micBtn) micBtn.disabled = true;
  setStatus('浏览器不支持语音识别，请用 Chrome 或 Safari', 'error');
}

// ─── Speech Recognition Setup ───
function initRecognition() {
  if (!SpeechRecognition) return null;

  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    console.log('[speech] started, lang:', rec.lang);
    isListening = true;
    micBtn.classList.add('listening');
    sourcePanel.classList.add('active');
    micLabel.textContent = '🔴 正在听... Listening (点击停止)';
    setStatus('🎙️ 请说话...', 'listening');
  };

  rec.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += t;
      } else {
        interim += t;
      }
    }

    if (interim) {
      setSourceText(interim, true);
    }
    if (final) {
      setSourceText(final, false);
      translate(final);
    }
  };

  rec.onerror = (event) => {
    console.warn('[speech] error:', event.error);
    isListening = false;
    micBtn.classList.remove('listening');
    sourcePanel.classList.remove('active');

    if (event.error === 'no-speech') {
      setStatus('没有检测到语音，请再试一次', 'warning');
      micLabel.textContent = '点击开始说话 Tap to speak';
    } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      setStatus('🚫 麦克风权限被拒绝', 'error');
      micLabel.textContent = '需要麦克风权限';
    } else if (event.error === 'network') {
      setStatus('网络错误，请检查网络连接', 'error');
      micLabel.textContent = '点击重试';
    } else if (event.error !== 'aborted') {
      setStatus(`语音识别错误: ${event.error}`, 'error');
      micLabel.textContent = '点击重试';
    }
  };

  rec.onend = () => {
    console.log('[speech] ended');
    isListening = false;
    micBtn.classList.remove('listening');
    sourcePanel.classList.remove('active');

    if (!stoppingManually && continuous && !isTranslating && !isSpeaking) {
      setTimeout(() => startListening(), 800);
    } else if (!isTranslating) {
      micLabel.textContent = '点击开始说话 Tap to speak';
    }
  };

  return rec;
}

// ─── Start / Stop listening ───
function startListening() {
  if (isListening || isSpeaking) return;
  if (!recognition) recognition = initRecognition();
  if (!recognition) return;

  stoppingManually = false;
  recognition.lang = sourceLangSel.value;

  try {
    recognition.start();
  } catch (e) {
    console.warn('[speech] start error:', e.message);
  }
}

function stopListening() {
  if (!isListening || !recognition) return;
  stoppingManually = true;
  try {
    recognition.stop();
  } catch (e) {
    console.warn('[speech] stop error:', e.message);
  }
  isListening = false;
  micBtn.classList.remove('listening');
  micLabel.textContent = '点击开始说话 Tap to speak';
}

// ─── Translation via Gemini ───
async function translate(text) {
  if (!text.trim()) return;

  isTranslating = true;
  setStatus('⏳ 翻译中...', 'info');
  setTargetText('...', true);
  micLabel.textContent = '翻译中...';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(`${API_BASE}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.trim(),
        sourceLang: sourceLangSel.value,
        targetLang: targetLangSel.value,
        scene: currentScene,
        noisyEnv,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: `HTTP ${resp.status}` }));
      throw new Error(err.message || `翻译请求失败 (${resp.status})`);
    }

    const data = await resp.json();
    setTargetText(data.translation, false);
    setStatus(`✅ 翻译完成 (${data.latencyMs}ms)`, 'success');
    addHistory(text, data.translation);

    // Update token cost
    if (data.tokensIn || data.tokensOut) {
      totalTokensIn += data.tokensIn || 0;
      totalTokensOut += data.tokensOut || 0;
      totalCostTHB += data.costTHB || 0;
      updateCostBadge();
    }

    if (autoSpeak && data.translation) {
      speak(data.translation, targetLangSel.value);
    } else {
      micLabel.textContent = '点击开始说话 Tap to speak';
      if (continuous) setTimeout(() => startListening(), 500);
    }
  } catch (err) {
    console.error('[translate] error:', err);
    if (err.name === 'AbortError') {
      setStatus('翻译超时，请重试', 'error');
    } else {
      setStatus(`翻译失败: ${err.message}`, 'error');
    }
    setTargetText('翻译失败', false);
    micLabel.textContent = '点击重试';
  } finally {
    isTranslating = false;
  }
}

// ─── TTS — locked to standard voices ───
function speak(text, lang) {
  if (!text || !window.speechSynthesis) return;

  // Cancel any ongoing speech
  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.9;
  utterance.pitch = 1.0;

  // Use locked voice for the target language
  const voice = findBestVoice(lang);
  if (voice) {
    utterance.voice = voice;
    console.log('[tts] using voice:', voice.name, voice.lang);
  } else {
    console.log('[tts] no specific voice found for', lang, '- using default');
  }

  utterance.onstart = () => {
    isSpeaking = true;
    targetPanel.classList.add('active');
    micLabel.textContent = '🔊 朗读中...';
  };

  utterance.onend = () => {
    isSpeaking = false;
    targetPanel.classList.remove('active');
    micLabel.textContent = '点击开始说话 Tap to speak';
    if (continuous) setTimeout(() => startListening(), 500);
  };

  utterance.onerror = (e) => {
    console.warn('[tts] error:', e.error);
    isSpeaking = false;
    targetPanel.classList.remove('active');
    micLabel.textContent = '点击开始说话 Tap to speak';
    if (continuous) setTimeout(() => startListening(), 500);
  };

  speechSynthesis.speak(utterance);
}

// ─── UI Helpers ───
function setSourceText(text, isInterim) {
  sourceText.textContent = text;
  sourceText.className = isInterim ? 'panel-text interim' : 'panel-text';
}

function setTargetText(text, isLoading) {
  targetText.textContent = text;
  targetText.className = isLoading ? 'panel-text interim' : 'panel-text';
}

function setStatus(msg, type) {
  statusBar.textContent = msg;
  statusBar.className = `status-bar ${type || ''}`;
}

function addHistory(source, target) {
  history.unshift({ source, target, time: Date.now() });
  if (history.length > 20) history.pop();
  renderHistory();
}

function renderHistory() {
  historyCount.textContent = history.length ? `(${history.length})` : '';
  historyList.innerHTML = history.map(h => `
    <div class="history-item">
      <div class="history-source">${escHtml(h.source)}</div>
      <div class="history-target">${escHtml(h.target)}</div>
    </div>
  `).join('');
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function updateCostBadge() {
  const totalTokens = totalTokensIn + totalTokensOut;
  costBadge.style.display = totalTokens > 0 ? 'flex' : 'none';
  costVal.textContent = `฿${totalCostTHB.toFixed(4)}`;
  costTokens.textContent = `${totalTokens.toLocaleString()} tokens`;
}

// ─── Event bindings ───
function bindEvents() {
  // Mic button
  micBtn.addEventListener('click', () => {
    if (isSpeaking) {
      speechSynthesis.cancel();
      isSpeaking = false;
      return;
    }
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  });

  // Swap languages
  swapBtn.addEventListener('click', () => {
    const src = sourceLangSel.value;
    const tgt = targetLangSel.value;
    sourceLangSel.value = tgt;
    targetLangSel.value = src;
  });

  // Prevent same source/target
  sourceLangSel.addEventListener('change', () => {
    if (sourceLangSel.value === targetLangSel.value) {
      const others = ALL_LANGS.filter(l => l !== sourceLangSel.value);
      targetLangSel.value = others[0];
    }
  });
  targetLangSel.addEventListener('change', () => {
    if (targetLangSel.value === sourceLangSel.value) {
      const others = ALL_LANGS.filter(l => l !== targetLangSel.value);
      sourceLangSel.value = others[0];
    }
  });

  // Speak button (replay translation)
  speakBtn.addEventListener('click', () => {
    const text = targetText.textContent;
    if (text && !targetText.classList.contains('placeholder') && !targetText.classList.contains('interim')) {
      speak(text, targetLangSel.value);
    }
  });

  // Controls
  autoSpeakCb.addEventListener('change', () => { autoSpeak = autoSpeakCb.checked; });
  continuousCb.addEventListener('change', () => { continuous = continuousCb.checked; });
  noisyEnvCb.addEventListener('change', () => { noisyEnv = noisyEnvCb.checked; });

  // Scene selector
  sceneBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scene]');
    if (!btn) return;
    currentScene = btn.dataset.scene;
    sceneBar.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    console.log('[scene] switched to:', currentScene);
  });

  // Load voices (async on some browsers)
  if (window.speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => {
      voiceCache = {}; // Clear cache to re-resolve
      const voices = speechSynthesis.getVoices();
      console.log('[tts] voices loaded:', voices.length);
      // Log available voices for debugging
      const langGroups = {};
      voices.forEach(v => {
        const key = v.lang.split('-')[0];
        if (!langGroups[key]) langGroups[key] = [];
        langGroups[key].push(`${v.name} (${v.lang})`);
      });
      ['zh', 'en', 'th', 'lo'].forEach(k => {
        if (langGroups[k]) console.log(`[tts] ${k}:`, langGroups[k].join(', '));
      });
    };
  }
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  recognition = initRecognition();
  bindEvents();
  console.log('[app] NYCKING Voice Translator ready');
  console.log('[app] Speech Recognition:', !!SpeechRecognition);
  console.log('[app] Speech Synthesis:', !!window.speechSynthesis);
  console.log('[app] Supported langs:', ALL_LANGS.join(', '));
});

// ─── Service Worker ───
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
