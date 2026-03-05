/**
 * Translation endpoint — uses Gemini 2.5 Flash (thinking disabled) for low-latency translation
 * Supports: Chinese ↔ Thai, Chinese ↔ English, English ↔ Thai
 */

import { Router, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config";
import { logger } from "../logger";

const router = Router();

const LANG_NAMES: Record<string, string> = {
  "zh-CN": "Chinese (Simplified Mandarin)",
  "th-TH": "Thai",
  "en-US": "English",
};

let genAI: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
  if (!genAI) {
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }
    genAI = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return genAI;
}

router.post("/translate", async (req: Request, res: Response) => {
  try {
    const { text, sourceLang, targetLang } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text'" });
    }
    if (!sourceLang || !LANG_NAMES[sourceLang]) {
      return res.status(400).json({ error: "Invalid 'sourceLang'. Use: zh-CN, th-TH, en-US" });
    }
    if (!targetLang || !LANG_NAMES[targetLang]) {
      return res.status(400).json({ error: "Invalid 'targetLang'. Use: zh-CN, th-TH, en-US" });
    }
    if (sourceLang === targetLang) {
      return res.json({ translation: text, sourceLang, targetLang });
    }

    const sourceName = LANG_NAMES[sourceLang];
    const targetName = LANG_NAMES[targetLang];

    const prompt = `You are an expert translator for travel and casual conversation between ${sourceName} and ${targetName}.

Translate the following text from ${sourceName} to ${targetName}.

Rules:
- Output ONLY the translation, no explanations, no quotes, no extra text
- Use natural, conversational language appropriate for travel and social situations
- Preserve the tone, intent, and emotion of the original
- For colloquial or romantic expressions, translate them naturally
- If the input is a greeting or short phrase, keep the translation similarly concise
- For Thai output, use polite particles (ค่ะ/ครับ) when appropriate

Text to translate:
${text}`;

    const startMs = Date.now();
    const result = await getGenAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: 256,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });
    const translation = (result.text ?? "").trim();
    const latencyMs = Date.now() - startMs;

    logger.info("Translation completed", {
      sourceLang,
      targetLang,
      inputLen: text.length,
      outputLen: translation.length,
      latencyMs,
    });

    return res.json({
      translation,
      sourceLang,
      targetLang,
      latencyMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Translation failed", { error: message });
    return res.status(502).json({ error: "Translation failed", message });
  }
});

export default router;
