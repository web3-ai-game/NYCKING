/**
 * Chat room endpoint — bilingual chat with Firestore persistence
 * Messages auto-translated and stored in both languages
 * Designed for 2-person couples chat with real-time polling
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

// In-memory fallback + Firestore persistence
interface ChatMessage {
  id: string;
  senderName: string;
  senderLang: string;
  originalText: string;
  translatedText: string;
  targetLang: string;
  timestamp: number;
}

let firestore: FirebaseFirestore.Firestore | null = null;
const COLLECTION = "nycking_chat";

// Memory fallback if Firestore unavailable
let memoryMessages: ChatMessage[] = [];

// Online presence — in-memory heartbeat map (name → last ping timestamp)
const onlineUsers: Map<string, { name: string; lang: string; ts: number }> = new Map();
const ONLINE_TIMEOUT = 15_000; // 15s no heartbeat = offline

async function getFirestore(): Promise<FirebaseFirestore.Firestore | null> {
  if (firestore) return firestore;
  try {
    const admin = await import("firebase-admin");
    if (!admin.apps.length) admin.initializeApp();
    firestore = admin.firestore();
    return firestore;
  } catch {
    return null;
  }
}

// GET /api/chat?since=timestamp — get messages (optionally after a timestamp)
router.get("/chat", async (req: Request, res: Response) => {
  try {
    const since = parseInt(req.query.since as string) || 0;
    const db = await getFirestore();

    if (db) {
      let query = db.collection(COLLECTION)
        .orderBy("timestamp", "asc")
        .limit(100);
      if (since > 0) {
        query = query.where("timestamp", ">", since);
      }
      const snap = await query.get();
      const messages: ChatMessage[] = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as ChatMessage[];
      // Prune stale users
      const now = Date.now();
      for (const [k, v] of onlineUsers) { if (now - v.ts > ONLINE_TIMEOUT) onlineUsers.delete(k); }
      const online = Array.from(onlineUsers.values()).map(u => ({ name: u.name, lang: u.lang }));
      return res.json({ messages, online });
    }

    // Memory fallback
    const filtered = since > 0
      ? memoryMessages.filter(m => m.timestamp > since)
      : memoryMessages;
    const now = Date.now();
    for (const [k, v] of onlineUsers) { if (now - v.ts > ONLINE_TIMEOUT) onlineUsers.delete(k); }
    const online = Array.from(onlineUsers.values()).map(u => ({ name: u.name, lang: u.lang }));
    return res.json({ messages: filtered, online });
  } catch (err) {
    logger.error("Chat GET failed", { error: err });
    return res.status(500).json({ error: "Failed to get messages" });
  }
});

// POST /api/chat — send a message (auto-translate via /api/translate internally)
router.post("/chat", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { senderName, senderLang, targetLang, text, scene } = req.body;

    if (!senderName || typeof senderName !== "string") {
      return res.status(400).json({ error: "Missing senderName" });
    }
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing text" });
    }
    if (!senderLang || !targetLang) {
      return res.status(400).json({ error: "Missing senderLang or targetLang" });
    }

    // Auto-translate using internal translate logic
    let translatedText = text;
    try {
      const { default: translateRouter } = await import("./translate");
      // We'll call the translate API internally via a mock request
      // Instead, let's use the Gemini API directly
      const { GoogleGenAI } = await import("@google/genai");
      const { config } = await import("../config");

      const LANG_NAMES: Record<string, string> = {
        "zh-CN": "Simplified Chinese (Mandarin)",
        "th-TH": "Standard Thai",
        "en-US": "American English",
        "lo-LA": "Standard Lao",
        "my-MM": "Standard Burmese (မြန်မာစာ)",
      };

      const PIVOT_LANGS = new Set(["my-MM", "lo-LA"]);
      const needsPivot = (s: string, t: string) => {
        const hasPivot = PIVOT_LANGS.has(s) || PIVOT_LANGS.has(t);
        const hasEN = s === "en-US" || t === "en-US";
        return hasPivot && !hasEN;
      };

      const genAI = new GoogleGenAI({ apiKey: config.geminiApiKey });

      const doTranslate = async (src: string, tgt: string, txt: string): Promise<string> => {
        const prompt = `You are a bilingual chat translator. Translate from ${LANG_NAMES[src] || src} to ${LANG_NAMES[tgt] || tgt}.
Context: ${scene === "romance" ? "Romantic couple conversation" : scene === "business" ? "Business discussion" : "Casual daily conversation"}.
Rules:
- Output ONLY the translation
- Be natural, conversational, warm
- Numbers, units, names: translate literally
- Use standard official language form only
- ANTI-DRIFT: Use only target language script

Text: ${txt}`;

        const result = await genAI.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: { temperature: 0.3, maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } },
        });
        return (result.text ?? "").trim();
      };

      if (senderLang !== targetLang) {
        if (needsPivot(senderLang, targetLang)) {
          const en = await doTranslate(senderLang, "en-US", text);
          translatedText = await doTranslate("en-US", targetLang, en);
        } else {
          translatedText = await doTranslate(senderLang, targetLang, text);
        }
      }
    } catch (translateErr) {
      logger.error("Chat translation failed", { error: translateErr });
      translatedText = `[翻译失败] ${text}`;
    }

    const message: ChatMessage = {
      id: "", // will be set by Firestore or generated
      senderName: senderName.trim().slice(0, 20),
      senderLang,
      originalText: text.trim().slice(0, 500),
      translatedText,
      targetLang,
      timestamp: Date.now(),
    };

    const db = await getFirestore();
    if (db) {
      const docRef = await db.collection(COLLECTION).add({
        senderName: message.senderName,
        senderLang: message.senderLang,
        originalText: message.originalText,
        translatedText: message.translatedText,
        targetLang: message.targetLang,
        timestamp: message.timestamp,
      });
      message.id = docRef.id;
    } else {
      message.id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      memoryMessages.push(message);
      if (memoryMessages.length > 200) memoryMessages = memoryMessages.slice(-100);
    }

    logger.info("Chat message sent", {
      sender: message.senderName,
      senderLang,
      targetLang,
      textLen: text.length,
    });

    return res.json({ message });
  } catch (err) {
    logger.error("Chat POST failed", { error: err });
    return res.status(500).json({ error: "Failed to send message" });
  }
});

// POST /api/chat/ping — heartbeat for online presence
router.post("/chat/ping", (req: Request, res: Response) => {
  const { name, lang } = req.body;
  if (name && typeof name === "string") {
    onlineUsers.set(name, { name: name.trim().slice(0, 20), lang: lang || "en-US", ts: Date.now() });
  }
  // Prune stale
  const now = Date.now();
  for (const [k, v] of onlineUsers) { if (now - v.ts > ONLINE_TIMEOUT) onlineUsers.delete(k); }
  const online = Array.from(onlineUsers.values()).map(u => ({ name: u.name, lang: u.lang }));
  return res.json({ online });
});

// DELETE /api/chat/:id — delete a message
router.delete("/chat/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getFirestore();

    if (db) {
      await db.collection(COLLECTION).doc(id).delete();
    } else {
      memoryMessages = memoryMessages.filter(m => m.id !== id);
    }

    logger.info("Chat message deleted", { id });
    return res.json({ ok: true });
  } catch (err) {
    logger.error("Chat DELETE failed", { error: err });
    return res.status(500).json({ error: "Failed to delete message" });
  }
});

// DELETE /api/chat — clear all messages
router.delete("/chat", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const db = await getFirestore();
    if (db) {
      const snap = await db.collection(COLLECTION).get();
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } else {
      memoryMessages = [];
    }
    logger.info("Chat cleared");
    return res.json({ ok: true });
  } catch (err) {
    logger.error("Chat clear failed", { error: err });
    return res.status(500).json({ error: "Failed to clear chat" });
  }
});

export default router;
