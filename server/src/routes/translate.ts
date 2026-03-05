/**
 * Translation endpoint — Gemini 2.5 Flash (thinking disabled)
 * Languages: Chinese ↔ Thai ↔ English ↔ Lao ↔ Myanmar (all pairs)
 * Myanmar: auto-pivot via English to prevent drift
 * Context: accepts recent ~10 translations for consistency
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
  "my-MM": "Standard Burmese (မြန်မာစာ)",
};

const VALID_LANGS = new Set(Object.keys(LANG_NAMES));

// Languages that need English pivot to avoid translation drift
const PIVOT_LANGS = new Set(["my-MM", "lo-LA"]);

const SCENE_PROMPTS: Record<string, string> = {
  travel: `Context: Travel & Daily Life — asking directions, ordering food, shopping at markets, hotel check-in, transportation, sightseeing.
Vocabulary style: casual, friendly, practical. Use common everyday phrases.`,

  romance: `Context: Romance & Relationships — dating, expressing feelings, compliments, flirting, intimate conversation, emotional support, friendship bonding.
Vocabulary style: warm, affectionate, emotionally expressive. Use natural romantic/friendly expressions.`,

  business: `Context: Business & Professional — meetings, contracts, negotiations, risk management, formal discussions, presentations, legal terms.
Vocabulary style: formal, precise, professional. Use proper business terminology.`,
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

interface ContextEntry {
  source: string;
  target: string;
}

function buildPrompt(
  sourceName: string,
  targetName: string,
  scenePrompt: string,
  noiseNote: string,
  context: ContextEntry[],
  text: string,
): string {
  const contextBlock = context.length > 0
    ? `\nRecent conversation for reference (maintain consistency with these):\n${context.map((c, i) => `${i + 1}. "${c.source}" → "${c.target}"`).join("\n")}\n`
    : "";

  return `You are an expert ${sourceName} ↔ ${targetName} translator.

${scenePrompt}
${noiseNote}
${contextBlock}
Translate the following from ${sourceName} to ${targetName}.

Rules:
- Output ONLY the translation, no explanations, no quotes, no extra text
- Use the official standard form of each language:
  · Chinese → Simplified Chinese (普通话/Mandarin), never Traditional/Cantonese/Taiwanese
  · English → American English
  · Thai → Standard Central Thai (ภาษาไทยกลาง), use polite particles ครับ/ค่ะ
  · Lao → Standard Lao (ພາສາລາວ), use polite forms
  · Burmese → Standard Myanmar (မြန်မာစာ), Yangon-based standard, use proper Myanmar script
- LITERAL translation rules (never paraphrase these):
  · Numbers: translate digits/amounts exactly (e.g. "500" → "500", "三百" → "300")
  · Units: keep original measurement units (kg, km, THB, MMK, LAK, USD, ฿, etc.)
  · Proper nouns: keep names, brand names, place names as-is or standard transliteration
  · Dates and times: preserve exact values
- Preserve the tone, intent, and emotion of the original
- Keep greetings and short phrases concise
- Be natural and conversational for the given context
- ANTI-DRIFT: Do NOT mix scripts or borrow words from other languages. Use only the target language's standard script and vocabulary.

Text:
${text}`;
}

async function callGemini(prompt: string): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
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
  const text = (result.text ?? "").trim();
  const usage = result.usageMetadata;
  return {
    text,
    tokensIn: usage?.promptTokenCount ?? Math.ceil(prompt.length / 4),
    tokensOut: usage?.candidatesTokenCount ?? Math.ceil(text.length / 4),
  };
}

// Determine if we need English pivot (for Myanmar/Lao ↔ non-English)
function needsPivot(sourceLang: string, targetLang: string): boolean {
  // If either lang is a pivot lang AND the other is NOT English → pivot through English
  const hasPivotLang = PIVOT_LANGS.has(sourceLang) || PIVOT_LANGS.has(targetLang);
  const hasEnglish = sourceLang === "en-US" || targetLang === "en-US";
  // Also pivot between two pivot langs (e.g. Myanmar ↔ Lao)
  const bothPivot = PIVOT_LANGS.has(sourceLang) && PIVOT_LANGS.has(targetLang);
  return hasPivotLang && !hasEnglish || bothPivot;
}

router.post("/translate", async (req: Request, res: Response) => {
  try {
    const { text, sourceLang, targetLang, scene, noisyEnv, context } = req.body;

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

    // Sanitize context array (max 10 entries)
    const ctxArr: ContextEntry[] = Array.isArray(context)
      ? context.slice(-10).filter((c: any) => c?.source && c?.target)
      : [];

    const sceneKey = (scene && SCENE_PROMPTS[scene]) ? scene : "travel";
    const scenePrompt = SCENE_PROMPTS[sceneKey];
    const noiseNote = noisyEnv
      ? `\nIMPORTANT: The input may contain speech recognition errors due to outdoor noise. Infer the intended meaning from context.`
      : "";

    const startMs = Date.now();
    let translation: string;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let pivotUsed = false;

    if (needsPivot(sourceLang, targetLang)) {
      // === PIVOT TRANSLATION via English ===
      pivotUsed = true;
      const sourceName = LANG_NAMES[sourceLang];
      const enName = LANG_NAMES["en-US"];
      const targetName = LANG_NAMES[targetLang];

      // Step 1: Source → English
      const prompt1 = buildPrompt(sourceName, enName, scenePrompt, noiseNote, ctxArr, text);
      const r1 = await callGemini(prompt1);
      totalTokensIn += r1.tokensIn;
      totalTokensOut += r1.tokensOut;

      // Step 2: English → Target
      const prompt2 = buildPrompt(enName, targetName, scenePrompt, "", [], r1.text);
      const r2 = await callGemini(prompt2);
      totalTokensIn += r2.tokensIn;
      totalTokensOut += r2.tokensOut;

      translation = r2.text;
      logger.info("Pivot translation completed", {
        path: `${sourceLang} → en-US → ${targetLang}`,
        intermediate: r1.text,
      });
    } else {
      // === DIRECT TRANSLATION ===
      const sourceName = LANG_NAMES[sourceLang];
      const targetName = LANG_NAMES[targetLang];
      const prompt = buildPrompt(sourceName, targetName, scenePrompt, noiseNote, ctxArr, text);
      const r = await callGemini(prompt);
      translation = r.text;
      totalTokensIn = r.tokensIn;
      totalTokensOut = r.tokensOut;
    }

    const latencyMs = Date.now() - startMs;
    const costUSD = (totalTokensIn * PRICE_INPUT_PER_M + totalTokensOut * PRICE_OUTPUT_PER_M) / 1_000_000;
    const costTHB = Math.round(costUSD * USD_TO_THB * 10000) / 10000;

    logger.info("Translation completed", {
      sourceLang,
      targetLang,
      scene: sceneKey,
      pivotUsed,
      noisyEnv: !!noisyEnv,
      contextLen: ctxArr.length,
      inputLen: text.length,
      outputLen: translation.length,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      costTHB,
      latencyMs,
    });

    return res.json({
      translation,
      sourceLang,
      targetLang,
      scene: sceneKey,
      pivotUsed,
      latencyMs,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      costTHB,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Translation failed", { error: message });
    return res.status(502).json({ error: "Translation failed", message });
  }
});

export default router;
