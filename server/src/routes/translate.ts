/**
 * Translation endpoint — Gemini 2.5 Flash (thinking disabled)
 * Languages: Chinese(Simplified) ↔ Thai ↔ English ↔ Lao (all pairs)
 * Scenes: travel, romance, business
 */

import { Router, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config";
import { logger } from "../logger";

const router = Router();

const LANG_NAMES: Record<string, string> = {
  "zh-CN": "Simplified Chinese (Mandarin / 普通话)",
  "th-TH": "Standard Thai (ภาษาไทยกลาง)",
  "en-US": "American English",
  "lo-LA": "Standard Lao (ພາສາລາວ)",
};

const VALID_LANGS = new Set(Object.keys(LANG_NAMES));

const SCENE_PROMPTS: Record<string, string> = {
  travel: `Context: Travel & Daily Life — asking directions, ordering food, shopping at markets, hotel check-in, transportation, sightseeing.
Vocabulary style: casual, friendly, practical. Use common everyday phrases.
Examples: "How much is this?", "Where is the bathroom?", "I'd like to check in."`,

  romance: `Context: Romance & Relationships — dating, expressing feelings, compliments, flirting, intimate conversation, emotional support, friendship bonding.
Vocabulary style: warm, affectionate, emotionally expressive. Use natural romantic/friendly expressions.
Examples: "You look beautiful today", "I miss you", "Let's go on a date", "You're my best friend."`,

  business: `Context: Business & Professional — meetings, contracts, negotiations, risk management, formal discussions, presentations, legal terms.
Vocabulary style: formal, precise, professional. Use proper business terminology.
Examples: "Let's review the contract terms", "What's your proposed timeline?", "We need to discuss the risk factors."`,
};

// Gemini 2.5 Flash pricing (USD per 1M tokens)
const PRICE_INPUT_PER_M = 0.15;
const PRICE_OUTPUT_PER_M = 0.60;
const USD_TO_THB = 35;

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
    const { text, sourceLang, targetLang, scene, noisyEnv } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text'" });
    }
    if (!sourceLang || !VALID_LANGS.has(sourceLang)) {
      return res.status(400).json({ error: `Invalid 'sourceLang'. Use: ${[...VALID_LANGS].join(", ")}` });
    }
    if (!targetLang || !VALID_LANGS.has(targetLang)) {
      return res.status(400).json({ error: `Invalid 'targetLang'. Use: ${[...VALID_LANGS].join(", ")}` });
    }
    if (sourceLang === targetLang) {
      return res.json({ translation: text, sourceLang, targetLang, tokensIn: 0, tokensOut: 0, costTHB: 0 });
    }

    const sourceName = LANG_NAMES[sourceLang];
    const targetName = LANG_NAMES[targetLang];
    const sceneKey = (scene && SCENE_PROMPTS[scene]) ? scene : "travel";
    const scenePrompt = SCENE_PROMPTS[sceneKey];

    const noiseNote = noisyEnv
      ? `\nIMPORTANT: The input may contain speech recognition errors due to outdoor noise. Try to infer the intended meaning from context and translate the most likely intended phrase.`
      : "";

    const prompt = `You are an expert ${sourceName} ↔ ${targetName} translator.

${scenePrompt}
${noiseNote}

Translate the following from ${sourceName} to ${targetName}.

Rules:
- Output ONLY the translation, no explanations, no quotes, no extra text
- Use the official standard form of each language:
  · Chinese → Simplified Chinese (普通话/Mandarin), never Traditional/Cantonese/Taiwanese
  · English → American English
  · Thai → Standard Central Thai (ภาษาไทยกลาง), use polite particles ครับ/ค่ะ
  · Lao → Standard Lao (ພາສາລາວ), use polite forms
- Preserve the tone, intent, and emotion of the original
- Keep greetings and short phrases concise
- Be natural and conversational for the given context

Text:
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

    // Estimate token usage from response metadata
    const usage = result.usageMetadata;
    const tokensIn = usage?.promptTokenCount ?? Math.ceil(prompt.length / 4);
    const tokensOut = usage?.candidatesTokenCount ?? Math.ceil(translation.length / 4);
    const costUSD = (tokensIn * PRICE_INPUT_PER_M + tokensOut * PRICE_OUTPUT_PER_M) / 1_000_000;
    const costTHB = Math.round(costUSD * USD_TO_THB * 10000) / 10000; // 4 decimal places

    logger.info("Translation completed", {
      sourceLang,
      targetLang,
      scene: sceneKey,
      noisyEnv: !!noisyEnv,
      inputLen: text.length,
      outputLen: translation.length,
      tokensIn,
      tokensOut,
      costTHB,
      latencyMs,
    });

    return res.json({
      translation,
      sourceLang,
      targetLang,
      scene: sceneKey,
      latencyMs,
      tokensIn,
      tokensOut,
      costTHB,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Translation failed", { error: message });
    return res.status(502).json({ error: "Translation failed", message });
  }
});

export default router;
