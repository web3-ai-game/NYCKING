/**
 * Moments endpoint — social feed with Firestore
 * GET  /api/moments           — feed (friends + own moments)
 * POST /api/moments           — create moment
 * POST /api/moments/:id/like  — toggle like
 * POST /api/moments/:id/comment — add comment
 * DELETE /api/moments/:id     — delete own moment
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

// GET /api/moments — feed
router.get("/moments", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();

    // Get friend UIDs
    const friendSnap = await db.collection("friendships")
      .where("participants", "array-contains", req.uid)
      .where("status", "==", "accepted")
      .get();

    const friendUids = friendSnap.docs.map(d => {
      const p = d.data().participants as string[];
      return p.find(u => u !== req.uid)!;
    });

    // Include self
    const feedUids = [req.uid!, ...friendUids];

    // Fetch moments from all feed UIDs (Firestore "in" supports max 30)
    const chunks = [];
    for (let i = 0; i < feedUids.length; i += 30) {
      chunks.push(feedUids.slice(i, i + 30));
    }

    const moments: any[] = [];
    for (const chunk of chunks) {
      const snap = await db.collection("moments")
        .where("userId", "in", chunk)
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();
      for (const doc of snap.docs) {
        moments.push({ id: doc.id, ...doc.data() });
      }
    }

    // Sort by createdAt desc
    moments.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    // Enrich with user info
    const userCache: Record<string, any> = {};
    for (const m of moments) {
      if (!userCache[m.userId]) {
        const uSnap = await db.collection("users").doc(m.userId).get();
        userCache[m.userId] = uSnap.exists ? uSnap.data() : {};
      }
      const u = userCache[m.userId];
      m.displayName = u.displayName || "Unknown";
      m.avatar = u.avatar || "😊";
      m.username = u.username || "";
      m.likeCount = (m.likes || []).length;
      m.liked = (m.likes || []).includes(req.uid);
      m.commentCount = m.commentCount || 0;
      delete m.likes; // Don't send full list
    }

    return res.json({ moments: moments.slice(0, 50) });
  } catch (err) {
    logger.error("Get moments failed", { error: err });
    return res.status(500).json({ error: "Failed to get feed" });
  }
});

// POST /api/moments — create
router.post("/moments", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "Missing content" });
    }

    const db = await getDB();
    const ref = await db.collection("moments").add({
      userId: req.uid,
      content: content.trim().slice(0, 1000),
      likes: [],
      commentCount: 0,
      createdAt: new Date().toISOString(),
    });

    logger.info("Moment created", { id: ref.id, uid: req.uid });
    return res.json({ id: ref.id });
  } catch (err) {
    logger.error("Create moment failed", { error: err });
    return res.status(500).json({ error: "Failed to create moment" });
  }
});

// POST /api/moments/:id/like — toggle like
router.post("/moments/:id/like", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();
    const admin = await import("firebase-admin");
    const ref = db.collection("moments").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Moment not found" });

    const likes = (snap.data()!.likes || []) as string[];
    if (likes.includes(req.uid!)) {
      await ref.update({ likes: admin.firestore.FieldValue.arrayRemove(req.uid) });
      return res.json({ liked: false, likeCount: likes.length - 1 });
    } else {
      await ref.update({ likes: admin.firestore.FieldValue.arrayUnion(req.uid) });
      return res.json({ liked: true, likeCount: likes.length + 1 });
    }
  } catch (err) {
    logger.error("Like moment failed", { error: err });
    return res.status(500).json({ error: "Failed to like" });
  }
});

// POST /api/moments/:id/comment
router.post("/moments/:id/comment", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing text" });
    }

    const db = await getDB();
    const admin = await import("firebase-admin");
    const momentRef = db.collection("moments").doc(req.params.id);
    const mSnap = await momentRef.get();
    if (!mSnap.exists) return res.status(404).json({ error: "Moment not found" });

    const userSnap = await db.collection("users").doc(req.uid!).get();
    const user = userSnap.exists ? userSnap.data()! : {};

    const commentRef = await momentRef.collection("comments").add({
      userId: req.uid,
      displayName: user.displayName || "Unknown",
      avatar: user.avatar || "😊",
      text: text.trim().slice(0, 500),
      createdAt: new Date().toISOString(),
    });

    await momentRef.update({ commentCount: admin.firestore.FieldValue.increment(1) });

    return res.json({ id: commentRef.id });
  } catch (err) {
    logger.error("Comment moment failed", { error: err });
    return res.status(500).json({ error: "Failed to comment" });
  }
});

// DELETE /api/moments/:id — delete own moment
router.delete("/moments/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();
    const ref = db.collection("moments").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Moment not found" });
    if (snap.data()!.userId !== req.uid) return res.status(403).json({ error: "Not your moment" });

    await ref.delete();
    logger.info("Moment deleted", { id: req.params.id });
    return res.json({ ok: true });
  } catch (err) {
    logger.error("Delete moment failed", { error: err });
    return res.status(500).json({ error: "Failed to delete" });
  }
});

export default router;
