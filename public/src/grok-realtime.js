/**
 * grok-realtime.js — Robust WebSocket client for xAI Grok Realtime Voice API
 * Features: auto-reconnect, exponential backoff, heartbeat, network detection
 */

const REALTIME_URL = "wss://api.x.ai/v1/realtime";

// Configurable API base — defaults to same origin, override for Cloud Run
const API_BASE = window.NYCKING_API_BASE || "";

export class GrokRealtime extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.sessionId = null;
    this._tokenCache = null;
    this._sessionConfig = null;

    // Reconnection state
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectTimer = null;
    this._intentionalClose = false;
    this._wasConnected = false;

    // Heartbeat
    this._heartbeatTimer = null;
    this._heartbeatInterval = 25000; // 25s (WebSocket timeout is usually 30s)
    this._lastPong = 0;

    // Network monitoring
    this._setupNetworkMonitor();
  }

  // --- Public API ---

  async connect(sessionConfig = null) {
    if (sessionConfig) this._sessionConfig = sessionConfig;
    this._intentionalClose = false;
    this._reconnectAttempts = 0;

    return this._doConnect();
  }

  async _doConnect() {
    // Clear any pending reconnect
    clearTimeout(this._reconnectTimer);

    this._emit("status", { phase: "token", message: "获取令牌 Getting token..." });

    let token;
    try {
      token = await this._getToken();
    } catch (err) {
      this._emit("status", { phase: "token_failed", message: err.message });
      throw err;
    }

    this._emit("status", { phase: "websocket", message: "建立连接 Connecting..." });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.connected) {
          this._closeWs();
          const err = new Error("连线超时 Connection timeout (15s)");
          this._emit("error", { message: err.message, recoverable: true });
          reject(err);
        }
      }, 15000);

      try {
        this.ws = new WebSocket(REALTIME_URL, [
          `xai-client-secret.${token}`,
        ]);
      } catch (e) {
        clearTimeout(timeout);
        reject(new Error("WebSocket 创建失败"));
        return;
      }

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.connected = true;
        this._wasConnected = true;
        this._reconnectAttempts = 0;
        this._lastPong = Date.now();
        this._emit("connected");
        this._startHeartbeat();
        resolve();
      };

      this.ws.onclose = (e) => {
        clearTimeout(timeout);
        const wasConnected = this.connected;
        this.connected = false;
        this.sessionId = null;
        this._stopHeartbeat();

        this._emit("disconnected", {
          code: e.code,
          reason: e.reason,
          intentional: this._intentionalClose,
        });

        if (!wasConnected && !this._intentionalClose) {
          reject(new Error(`WebSocket关闭: ${e.code} ${e.reason || ""}`));
          return;
        }

        // Auto-reconnect if not intentional
        if (!this._intentionalClose && this._wasConnected) {
          this._scheduleReconnect();
        }
      };

      this.ws.onerror = (e) => {
        console.error("[ws] error event");
        // Don't emit here — onclose will follow
      };

      this.ws.onmessage = (e) => {
        this._lastPong = Date.now();
        try {
          this._handleMessage(JSON.parse(e.data));
        } catch (err) {
          console.error("[ws] parse error:", err);
        }
      };
    });
  }

  updateSession(config) {
    this._sessionConfig = config;
    this._send({ type: "session.update", session: config });
  }

  appendAudio(base64) {
    if (!this.connected) return;
    this._send({ type: "input_audio_buffer.append", audio: base64 });
  }

  commitAudio() {
    this._send({ type: "input_audio_buffer.commit" });
    this._send({
      type: "response.create",
      response: { modalities: ["text", "audio"] },
    });
  }

  clearAudio() {
    this._send({ type: "input_audio_buffer.clear" });
  }

  disconnect() {
    this._intentionalClose = true;
    this._wasConnected = false;
    this._reconnectAttempts = 0;
    clearTimeout(this._reconnectTimer);
    this._stopHeartbeat();
    this._closeWs();
    this.connected = false;
    this.sessionId = null;
  }

  get isReconnecting() {
    return this._reconnectTimer !== null;
  }

  // --- Auto-Reconnect ---

  _scheduleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this._emit("reconnect_failed", {
        message: `重连失败 (${this._maxReconnectAttempts} attempts exhausted)`,
      });
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(
      1000 * Math.pow(2, this._reconnectAttempts),
      16000
    );
    this._reconnectAttempts++;

    this._emit("reconnecting", {
      attempt: this._reconnectAttempts,
      maxAttempts: this._maxReconnectAttempts,
      delayMs: delay,
    });

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        // Invalidate cached token (might have expired)
        this._tokenCache = null;
        await this._doConnect();

        // Re-apply session config after reconnect
        if (this._sessionConfig) {
          this.updateSession(this._sessionConfig);
        }

        this._emit("reconnected", { attempt: this._reconnectAttempts });
      } catch (err) {
        console.error("[ws] reconnect failed:", err);
        // onclose handler will schedule next attempt
      }
    }, delay);
  }

  // --- Heartbeat ---

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (!this.connected) return;

      // Check if we've received any message recently
      const silenceMs = Date.now() - this._lastPong;
      if (silenceMs > this._heartbeatInterval * 2) {
        console.warn("[ws] heartbeat timeout, connection appears dead");
        this.connected = false;
        this.sessionId = null;
        this._stopHeartbeat();
        this._closeWs();
        this._emit("disconnected", {
          code: 4000,
          reason: "heartbeat timeout",
          intentional: false,
        });
        if (this._wasConnected && !this._intentionalClose) {
          this._scheduleReconnect();
        }
        return;
      }

      // Send a ping via input_audio_buffer.clear (harmless, keeps connection alive)
      this._send({ type: "input_audio_buffer.clear" });
    }, this._heartbeatInterval);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // --- Network Monitor ---

  _setupNetworkMonitor() {
    if (typeof window === "undefined") return;

    window.addEventListener("online", () => {
      this._emit("network_change", { online: true });
      // If we were connected, try to reconnect
      if (this._wasConnected && !this.connected && !this._intentionalClose) {
        this._reconnectAttempts = 0; // Reset for fresh attempt
        this._scheduleReconnect();
      }
    });

    window.addEventListener("offline", () => {
      this._emit("network_change", { online: false });
    });

    // Visibility change — resume heartbeat when tab becomes visible
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.connected) {
        this._lastPong = Date.now();
        // Send a keep-alive
        this._send({ type: "input_audio_buffer.clear" });
      }
    });
  }

  // --- Token ---

  async _getToken() {
    // Use cached token if still valid (>60s remaining)
    if (this._tokenCache) {
      const remaining = this._tokenCache.expires_at - Date.now() / 1000;
      if (remaining > 60) return this._tokenCache.value;
    }

    const url = `${API_BASE}/api/token`;
    let resp;

    // Retry token fetch up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (resp.ok) break;

        // On 4xx, don't retry
        if (resp.status >= 400 && resp.status < 500) break;
      } catch (err) {
        if (attempt === 3) throw new Error(`令牌获取失败: 网络错误 (${err.message})`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
    }

    if (!resp || !resp.ok) {
      const err = await resp?.json().catch(() => ({}));
      throw new Error(err?.error || err?.message || `Token失败: ${resp?.status || "network"}`);
    }

    const data = await resp.json();
    const value = data.value || data.client_secret?.value;
    if (!value) throw new Error("Token格式错误");

    this._tokenCache = {
      value,
      expires_at: data.expires_at || Date.now() / 1000 + 240,
    };
    return value;
  }

  // --- Internal ---

  _closeWs() {
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(obj));
      } catch (err) {
        console.error("[ws] send error:", err);
      }
    }
  }

  _handleMessage(msg) {
    const t = msg.type;

    // Session
    if (t === "session.created") {
      this.sessionId = msg.session?.id;
      this._emit("session_created", msg.session);
      return;
    }
    if (t === "session.updated") {
      this._emit("session_updated", msg.session);
      return;
    }

    // Audio output
    if (t === "response.audio.delta" || t === "response.output_audio.delta") {
      this._emit("audio_delta", { delta: msg.delta });
      return;
    }
    if (t === "response.audio.done" || t === "response.output_audio.done") {
      this._emit("audio_done");
      return;
    }

    // Transcript output
    if (
      t === "response.audio_transcript.delta" ||
      t === "response.output_audio_transcript.delta"
    ) {
      this._emit("transcript_delta", { delta: msg.delta });
      return;
    }
    if (
      t === "response.audio_transcript.done" ||
      t === "response.output_audio_transcript.done"
    ) {
      this._emit("transcript_done", { transcript: msg.transcript });
      return;
    }

    // Input transcription
    if (t === "conversation.item.input_audio_transcription.completed") {
      this._emit("input_transcript", { transcript: msg.transcript });
      return;
    }

    // VAD events
    if (t === "input_audio_buffer.speech_started") {
      this._emit("speech_started");
      return;
    }
    if (t === "input_audio_buffer.speech_stopped") {
      this._emit("speech_stopped");
      return;
    }

    // Ping/pong keepalive
    if (t === "ping") return;
    if (t === "pong") return;

    // Response lifecycle
    if (t === "response.created") return;
    if (t === "response.output_item.added") return;
    if (t === "conversation.item.added") return;
    if (t === "conversation.created") return;
    if (t === "input_audio_buffer.cleared") return;
    if (t === "input_audio_buffer.committed") return;

    if (t === "response.done") {
      this._emit("response_done", msg.response);
      return;
    }

    // Error
    if (t === "error") {
      console.error("[ws] server error:", msg.error);
      this._emit("error", msg.error || { message: "Unknown error" });
      return;
    }

  }

  _emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
