/**
 * NYCKING Voice Translator — Main App
 * Architecture: Web Speech API (STT) → Gemini (Translate) → SpeechSynthesis (TTS)
 * No WebSocket. No complex connection management. Just works.
 */

const API_BASE = window.NYCKING_API_BASE || '';

// ─── State ───
let isListening = false;
let isSpeaking = false;
let isTranslating = false;
let recognition = null;
let continuous = false;
let autoSpeak = true;
let stoppingManually = false;
const history = [];

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
const historyList = $('history-list');
const historyCount = $('history-count');
const notSupported = $('not-supported');

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
    // Already started — ignore
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

// ─── TTS ───
function speak(text, lang) {
  if (!text || !window.speechSynthesis) return;

  // Cancel any ongoing speech
  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.9;
  utterance.pitch = 1.0;

  // Try to find a good voice
  const voices = speechSynthesis.getVoices();
  const langPrefix = lang.split('-')[0];
  const nativeVoice = voices.find(v => v.lang === lang) ||
                      voices.find(v => v.lang.startsWith(langPrefix));
  if (nativeVoice) utterance.voice = nativeVoice;

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
      const others = ['zh-CN', 'en-US', 'th-TH'].filter(l => l !== sourceLangSel.value);
      targetLangSel.value = others[0];
    }
  });
  targetLangSel.addEventListener('change', () => {
    if (targetLangSel.value === sourceLangSel.value) {
      const others = ['zh-CN', 'en-US', 'th-TH'].filter(l => l !== targetLangSel.value);
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

  // Load voices (async on some browsers)
  if (window.speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  recognition = initRecognition();
  bindEvents();
  console.log('[app] NYCKING Voice Translator ready');
  console.log('[app] Speech Recognition:', !!SpeechRecognition);
  console.log('[app] Speech Synthesis:', !!window.speechSynthesis);
});

// ─── Service Worker ───
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
