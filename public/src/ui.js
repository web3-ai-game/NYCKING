/**
 * ui.js — UI management + audio playback for NYCKING translator
 * Rebuilt with: toggle mic, retry button, loading states, iOS audio compat
 */

const SAMPLE_RATE = 24000;

export class UI {
  constructor() {
    this.connectBtn = document.getElementById("connect-btn");
    this.micBtn = document.getElementById("mic-btn");
    this.ripple = document.getElementById("ripple");
    this.statusEl = document.getElementById("status");
    this.inputText = document.getElementById("input-text");
    this.outputText = document.getElementById("output-text");
    this.langIndicator = document.getElementById("lang-indicator");
    this.retryBtn = document.getElementById("retry-btn");

    // Audio playback
    this._audioCtx = null;
    this._nextPlayTime = 0;
    this._sources = [];

    // Mic mode: "toggle" (tap) or "hold" (press-and-hold)
    this._micMode = "toggle";
    this._isHolding = false;
    this._holdTimer = null;

    // Callbacks (set by App)
    this.onConnect = null;
    this.onMicToggle = null;
    this.onPressStart = null;
    this.onPressEnd = null;

    this._bindEvents();
  }

  _bindEvents() {
    // Connect button
    this.connectBtn.addEventListener("click", () => {
      if (this.onConnect) this.onConnect();
    });

    // Retry button
    if (this.retryBtn) {
      this.retryBtn.addEventListener("click", () => {
        if (this.onConnect) this.onConnect();
      });
    }

    // Mic button — smart mode: short tap = toggle, long press = hold-to-talk
    let pressStart = 0;
    let isTouching = false; // Prevent mouse events from double-firing on mobile
    const HOLD_THRESHOLD = 300; // ms

    const handleDown = (e) => {
      e.preventDefault();
      this._ensureAudioCtx();
      pressStart = Date.now();
      this._isHolding = false;

      // Start hold timer — if held > threshold, switch to hold mode
      this._holdTimer = setTimeout(() => {
        this._isHolding = true;
        if (this.onPressStart) this.onPressStart();
      }, HOLD_THRESHOLD);
    };

    const handleUp = (e) => {
      e.preventDefault();
      clearTimeout(this._holdTimer);
      const duration = Date.now() - pressStart;

      if (this._isHolding) {
        // Was holding — release = stop
        this._isHolding = false;
        if (this.onPressEnd) this.onPressEnd();
      } else if (duration < HOLD_THRESHOLD) {
        // Short tap — toggle mode
        if (this.onMicToggle) this.onMicToggle();
      }
    };

    const handleCancel = (e) => {
      e.preventDefault();
      clearTimeout(this._holdTimer);
      if (this._isHolding) {
        this._isHolding = false;
        if (this.onPressEnd) this.onPressEnd();
      }
    };

    // Touch events (mobile) — set flag to block duplicate mouse events
    this.micBtn.addEventListener("touchstart", (e) => { isTouching = true; handleDown(e); }, { passive: false });
    this.micBtn.addEventListener("touchend", (e) => { handleUp(e); setTimeout(() => { isTouching = false; }, 400); }, { passive: false });
    this.micBtn.addEventListener("touchcancel", (e) => { handleCancel(e); setTimeout(() => { isTouching = false; }, 400); }, { passive: false });

    // Mouse events (desktop) — skip if touch just happened
    this.micBtn.addEventListener("mousedown", (e) => { if (!isTouching) handleDown(e); });
    this.micBtn.addEventListener("mouseup", (e) => { if (!isTouching) handleUp(e); });
    this.micBtn.addEventListener("mouseleave", (e) => { if (!isTouching) handleCancel(e); });

    // Prevent context menu on long press (mobile)
    this.micBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _ensureAudioCtx() {
    if (!this._audioCtx || this._audioCtx.state === "closed") {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      });
    }
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume();
    }
  }

  // --- State Updates ---

  setConnected(connected) {
    if (connected) {
      this.connectBtn.textContent = "已连线 Connected ●";
      this.connectBtn.classList.add("connected");
      this.micBtn.disabled = false;
      this.micBtn.classList.remove("disabled");
    } else {
      this.connectBtn.textContent = "连线 Connect";
      this.connectBtn.classList.remove("connected");
      this.micBtn.disabled = true;
      this.micBtn.classList.add("disabled");
    }
  }

  setConnectLoading(loading) {
    if (loading) {
      this.connectBtn.disabled = true;
      this.connectBtn.textContent = "⏳ 连线中...";
      this.connectBtn.classList.add("loading");
    } else {
      this.connectBtn.disabled = false;
      this.connectBtn.classList.remove("loading");
    }
  }

  showRetry(show) {
    if (this.retryBtn) {
      this.retryBtn.style.display = show ? "block" : "none";
    }
  }

  setListening(active) {
    if (active) {
      this.micBtn.classList.add("active");
      this.ripple.classList.add("pulse");
      this.micBtn.textContent = "⏹";
      this.setStatus("🎙️ 听取中 Listening... (点击停止 Tap to stop)", "listening");
    } else {
      this.micBtn.classList.remove("active");
      this.ripple.classList.remove("pulse");
      this.micBtn.textContent = "🎤";
    }
  }

  setIdle() {
    this.micBtn.classList.remove("active");
    this.ripple.classList.remove("pulse");
    this.micBtn.textContent = "🎤";
    this.setStatus("点击说话 Tap to speak · 长按持续 Hold for continuous", "info");
  }

  setTranslating() {
    this.micBtn.classList.remove("active");
    this.ripple.classList.remove("pulse");
    this.micBtn.textContent = "🎤";
    this.setStatus("⏳ 翻译中 Translating...", "translating");
  }

  setStatus(text, cls = "") {
    this.statusEl.textContent = text;
    this.statusEl.className = "status " + cls;
  }

  setInputText(text) {
    this.inputText.textContent = text;
  }

  setOutputText(text) {
    this.outputText.textContent = text;
  }

  setLangIndicator(from, to) {
    this.langIndicator.textContent = `${from} → ${to}`;
  }

  // --- Audio Playback ---

  queueAudio(base64Pcm16) {
    this._ensureAudioCtx();
    try {
      const binary = atob(base64Pcm16);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      const buffer = this._audioCtx.createBuffer(1, float32.length, SAMPLE_RATE);
      buffer.copyToChannel(float32, 0);

      const source = this._audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this._audioCtx.destination);

      const now = this._audioCtx.currentTime;
      const startTime = Math.max(now + 0.01, this._nextPlayTime);
      source.start(startTime);
      this._nextPlayTime = startTime + buffer.duration;

      this._sources.push(source);
      source.onended = () => {
        const idx = this._sources.indexOf(source);
        if (idx >= 0) this._sources.splice(idx, 1);
      };
    } catch (e) {
      console.error("[ui] audio decode error:", e);
    }
  }

  flushAudio() {
    for (const src of this._sources) {
      try {
        src.stop();
      } catch (_) {}
    }
    this._sources = [];
    this._nextPlayTime = 0;
  }
}
