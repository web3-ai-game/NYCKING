/**
 * AI Coach endpoint — Gemini 2.5 Flash
 * Modes: topics (conversation starters), polish (message rewrite), reply (suggest replies)
 * Subtle communication helper, not dating-specific
 */

import { Router, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config";
import { logger } from "../logger";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

let genAI: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!genAI) {
    if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY not configured");
    genAI = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return genAI;
}

const LANG_MAP: Record<string, string> = {
  en: "English",
  zh: "Chinese (Simplified)",
  th: "Thai",
  my: "Burmese (Myanmar)",
};

const STAGE_HINTS: Record<string, string> = {
  new: "They just met recently. Keep it light, curious, friendly. Avoid anything too personal or forward.",
  friends: "They are friends getting closer. Can be more personal, share feelings, ask deeper questions.",
  close: "They are close / in a relationship. Can be intimate, sweet, caring, emotionally open.",
};

// ─── MODE: Topics ───
function buildTopicsPrompt(lang: string, stage: string): string {
  const langName = LANG_MAP[lang] || "English";
  const stageHint = STAGE_HINTS[stage] || STAGE_HINTS.new;
  return `You are a friendly communication coach. Generate 5 interesting conversation topics/questions that someone can use to start or continue a conversation with someone they care about.

Stage: ${stageHint}

Rules:
- Output in ${langName}
- Each topic on a new line, numbered 1-5
- Be creative, warm, and natural
- Mix of fun, thoughtful, and personal topics
- NOT generic like "how's the weather". Be specific and engaging
- Keep each suggestion under 2 sentences
- Do NOT add any labels, headers, or explanations. Just the 5 numbered items.`;
}

// ─── MODE: Polish ───
function buildPolishPrompt(lang: string, stage: string, draft: string): string {
  const langName = LANG_MAP[lang] || "English";
  const stageHint = STAGE_HINTS[stage] || STAGE_HINTS.new;
  return `You are a communication expert. Rewrite the following message to sound more natural, charming, and emotionally appropriate.

Stage: ${stageHint}

Rules:
- Output in ${langName}
- Provide exactly 2 versions:
  Version 1: A polished, natural rewrite
  Version 2: A more creative/charming alternative
- Keep the original meaning and intent
- Format: "1. [version1]\n2. [version2]"
- Do NOT add labels like "Version 1:" — just the numbered messages
- Do NOT add any explanations

Original message:
${draft}`;
}

// ─── MODE: Reply ───
function buildReplyPrompt(lang: string, stage: string, theirMessage: string): string {
  const langName = LANG_MAP[lang] || "English";
  const stageHint = STAGE_HINTS[stage] || STAGE_HINTS.new;
  return `You are a communication coach. Someone received this message and doesn't know how to reply. Suggest 3 possible replies.

Stage: ${stageHint}

Rules:
- Output in ${langName}
- Provide exactly 3 reply options, numbered 1-3
- Option 1: Friendly and safe
- Option 2: Warm and engaging
- Option 3: Bold and charming (but still appropriate)
- Each reply should be 1-2 sentences max
- Be natural, not cringey
- Do NOT add labels or explanations. Just the 3 numbered replies.

Their message:
${theirMessage}`;
}

const PRICE_INPUT_PER_M = 0.15;
const PRICE_OUTPUT_PER_M = 0.60;
const USD_TO_THB = 35;

router.post("/coach", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { mode, lang, stage, text } = req.body;

    if (!mode || !["topics", "polish", "reply"].includes(mode)) {
      return res.status(400).json({ error: "Invalid mode. Use: topics, polish, reply" });
    }
    const safeLang = LANG_MAP[lang] ? lang : "en";
    const safeStage = STAGE_HINTS[stage] ? stage : "new";

    if ((mode === "polish" || mode === "reply") && (!text || typeof text !== "string")) {
      return res.status(400).json({ error: "Missing 'text' for this mode" });
    }

    let prompt: string;
    if (mode === "topics") {
      prompt = buildTopicsPrompt(safeLang, safeStage);
    } else if (mode === "polish") {
      prompt = buildPolishPrompt(safeLang, safeStage, text);
    } else {
      prompt = buildReplyPrompt(safeLang, safeStage, text);
    }

    const startMs = Date.now();
    const result = await getGenAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.8,
        maxOutputTokens: 512,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const output = (result.text ?? "").trim();
    const usage = result.usageMetadata;
    const tokensIn = usage?.promptTokenCount ?? Math.ceil(prompt.length / 4);
    const tokensOut = usage?.candidatesTokenCount ?? Math.ceil(output.length / 4);
    const latencyMs = Date.now() - startMs;
    const costUSD = (tokensIn * PRICE_INPUT_PER_M + tokensOut * PRICE_OUTPUT_PER_M) / 1_000_000;
    const costTHB = Math.round(costUSD * USD_TO_THB * 10000) / 10000;

    logger.info("Coach completed", { mode, lang: safeLang, stage: safeStage, tokensIn, tokensOut, costTHB, latencyMs });

    return res.json({ result: output, mode, lang: safeLang, stage: safeStage, tokensIn, tokensOut, costTHB, latencyMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Coach failed", { error: message });
    return res.status(502).json({ error: "Coach failed", message });
  }
});

export default router;
