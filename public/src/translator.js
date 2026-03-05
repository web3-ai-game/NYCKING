/**
 * translator.js — Session config & system prompt for xAI Grok Realtime
 */

const TRANSLATOR_PROMPT = `You are a professional Thai-Chinese real-time voice interpreter.

RULES:
1. If the user speaks Thai → reply ONLY in Mandarin Chinese.
2. If the user speaks Chinese → reply ONLY in Thai.
3. Translate the MEANING, not word-by-word.
4. Keep the same tone and emotion as the original.
5. For romantic or casual speech, use natural, warm expressions.
6. For formal or professional speech, maintain politeness levels.
7. NEVER add explanations, commentary, or your own thoughts.
8. NEVER say "I" or refer to yourself. You are invisible.
9. If you cannot hear clearly, say "请再说一次 / พูดอีกครั้งได้ไหม".
10. Keep translations concise and natural-sounding.`;

export const SESSION_CONFIG = {
  instructions: TRANSLATOR_PROMPT,
  voice: "Eve",
  turn_detection: { type: "server_vad" },
  input_audio_transcription: { model: "grok-2-latest" },
  audio: {
    input: { format: { type: "audio/pcm", rate: 24000 } },
    output: { format: { type: "audio/pcm", rate: 24000 } },
  },
};

export function detectLanguage(text) {
  if (!text) return "unknown";
  const thaiRange = /[\u0E00-\u0E7F]/;
  const cjkRange = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
  if (thaiRange.test(text)) return "th";
  if (cjkRange.test(text)) return "zh";
  return "unknown";
}
