/**
 * Match endpoint — random user matching for chat
 * POST /api/match/join    — join matching queue
 * POST /api/match/leave   — leave queue
 * GET  /api/match/status   — check if matched
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

// POST /api/match/join — join the matching queue
router.post("/match/join", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { lang } = req.body;
    const db = await getDB();
    const col = db.collection("matchQueue");

    // Check if already in queue
    const existing = await col.where("uid", "==", req.uid).get();
    if (!existing.empty) {
      return res.json({ status: "waiting", message: "Already in queue" });
    }

    // Get user profile
    const userSnap = await db.collection("users").doc(req.uid!).get();
    const user = userSnap.exists ? userSnap.data()! : {};

    // Try to find a match (someone else in queue)
    const candidates = await col
      .where("uid", "!=", req.uid)
      .limit(1)
      .get();

    if (!candidates.empty) {
      // Match found! Create conversation and remove both from queue
      const match = candidates.docs[0];
      const matchData = match.data();

      // Create DM conversation
      const convRef = await db.collection("conversations").add({
        participants: [req.uid, matchData.uid],
        lastMessage: "Matched! Say hi 👋",
        lastMessageAt: new Date().toISOString(),
        matchedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });

      // Remove matched user from queue
      await match.ref.delete();

      logger.info("Match found", { user1: req.uid, user2: matchData.uid, convId: convRef.id });

      return res.json({
        status: "matched",
        conversationId: convRef.id,
        matchedWith: {
          uid: matchData.uid,
          displayName: matchData.displayName || "Unknown",
          avatar: matchData.avatar || "😊",
        },
      });
    }

    // No match yet, add to queue
    await col.add({
      uid: req.uid,
      displayName: user.displayName || "Unknown",
      avatar: user.avatar || "😊",
      lang: lang || user.lang || "en",
      joinedAt: new Date().toISOString(),
    });

    logger.info("User joined match queue", { uid: req.uid });
    return res.json({ status: "waiting", message: "In queue, waiting for match..." });
  } catch (err) {
    logger.error("Match join failed", { error: err });
    return res.status(500).json({ error: "Failed to join match" });
  }
});

// POST /api/match/leave — leave the queue
router.post("/match/leave", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();
    const snap = await db.collection("matchQueue").where("uid", "==", req.uid).get();
    for (const doc of snap.docs) await doc.ref.delete();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to leave queue" });
  }
});

// GET /api/match/status — check match status (poll)
router.get("/match/status", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();

    // Check if still in queue
    const inQueue = await db.collection("matchQueue").where("uid", "==", req.uid).get();
    if (!inQueue.empty) {
      // Try to find a match again
      const candidates = await db.collection("matchQueue")
        .where("uid", "!=", req.uid)
        .limit(1)
        .get();

      if (!candidates.empty) {
        const match = candidates.docs[0];
        const matchData = match.data();

        const convRef = await db.collection("conversations").add({
          participants: [req.uid, matchData.uid],
          lastMessage: "Matched! Say hi 👋",
          lastMessageAt: new Date().toISOString(),
          matchedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });

        // Remove both from queue
        for (const doc of inQueue.docs) await doc.ref.delete();
        await match.ref.delete();

        return res.json({
          status: "matched",
          conversationId: convRef.id,
          matchedWith: {
            uid: matchData.uid,
            displayName: matchData.displayName || "Unknown",
            avatar: matchData.avatar || "😊",
          },
        });
      }

      return res.json({ status: "waiting" });
    }

    return res.json({ status: "idle" });
  } catch (err) {
    return res.status(500).json({ error: "Failed to check status" });
  }
});

export default router;
