/**
 * DM (Direct Messages) endpoint — 1v1 friend chat with Firestore
 * POST /api/dm/start           — create or get conversation
 * GET  /api/dm                 — list conversations
 * GET  /api/dm/:id             — get messages in conversation
 * POST /api/dm/:id             — send message
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

let firestore: FirebaseFirestore.Firestore | null = null;

async function getDB(): Promise<FirebaseFirestore.Firestore> {
  if (firestore) return firestore;
  const admin = await import("firebase-admin");
  if (!admin.apps.length) admin.initializeApp();
  firestore = admin.firestore();
  return firestore;
}

// POST /api/dm/start — create or find existing conversation with a friend
router.post("/dm/start", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { targetUid } = req.body;
    if (!targetUid || targetUid === req.uid) {
      return res.status(400).json({ error: "Invalid target" });
    }

    const db = await getDB();
    const col = db.collection("conversations");

    // Check existing conversation
    const existing = await col
      .where("participants", "array-contains", req.uid)
      .get();

    for (const doc of existing.docs) {
      if (doc.data().participants.includes(targetUid)) {
        return res.json({ conversationId: doc.id, existing: true });
      }
    }

    // Create new conversation
    const ref = await col.add({
      participants: [req.uid, targetUid],
      lastMessage: "",
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    logger.info("Conversation created", { id: ref.id, participants: [req.uid, targetUid] });
    return res.json({ conversationId: ref.id, existing: false });
  } catch (err) {
    logger.error("DM start failed", { error: err });
    return res.status(500).json({ error: "Failed to start conversation" });
  }
});

// GET /api/dm — list user's conversations
router.get("/dm", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();
    const snap = await db.collection("conversations")
      .where("participants", "array-contains", req.uid)
      .orderBy("lastMessageAt", "desc")
      .limit(50)
      .get();

    const conversations = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      const otherUid = (d.participants as string[]).find(u => u !== req.uid)!;
      const userSnap = await db.collection("users").doc(otherUid).get();
      const user = userSnap.exists ? userSnap.data()! : {};
      conversations.push({
        id: doc.id,
        otherUid,
        displayName: user.displayName || "Unknown",
        avatar: user.avatar || "😊",
        username: user.username || "",
        lastMessage: d.lastMessage || "",
        lastMessageAt: d.lastMessageAt,
      });
    }

    return res.json({ conversations });
  } catch (err) {
    logger.error("List DM failed", { error: err });
    return res.status(500).json({ error: "Failed to list conversations" });
  }
});

// GET /api/dm/:id — get messages
router.get("/dm/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();
    const convRef = db.collection("conversations").doc(req.params.id);
    const convSnap = await convRef.get();
    if (!convSnap.exists) return res.status(404).json({ error: "Conversation not found" });

    const convData = convSnap.data()!;
    if (!(convData.participants as string[]).includes(req.uid!)) {
      return res.status(403).json({ error: "Not your conversation" });
    }

    const since = parseInt(req.query.since as string) || 0;
    let query = convRef.collection("messages").orderBy("createdAt", "asc") as FirebaseFirestore.Query;
    if (since) {
      query = query.where("createdAt", ">", new Date(since).toISOString());
    }
    const msgSnap = await query.limit(100).get();

    const messages = msgSnap.docs.map(d => ({
      id: d.id,
      ...d.data(),
    }));

    return res.json({ messages });
  } catch (err) {
    logger.error("Get DM messages failed", { error: err });
    return res.status(500).json({ error: "Failed to get messages" });
  }
});

// POST /api/dm/:id — send message
router.post("/dm/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing text" });
    }

    const db = await getDB();
    const convRef = db.collection("conversations").doc(req.params.id);
    const convSnap = await convRef.get();
    if (!convSnap.exists) return res.status(404).json({ error: "Conversation not found" });

    const convData = convSnap.data()!;
    if (!(convData.participants as string[]).includes(req.uid!)) {
      return res.status(403).json({ error: "Not your conversation" });
    }

    const now = new Date().toISOString();
    const msgRef = await convRef.collection("messages").add({
      sender: req.uid,
      text: text.trim().slice(0, 2000),
      createdAt: now,
    });

    // Update conversation lastMessage
    await convRef.update({
      lastMessage: text.trim().slice(0, 100),
      lastMessageAt: now,
    });

    return res.json({
      message: { id: msgRef.id, sender: req.uid, text: text.trim(), createdAt: now },
    });
  } catch (err) {
    logger.error("Send DM failed", { error: err });
    return res.status(500).json({ error: "Failed to send message" });
  }
});

export default router;
