/**
 * Friends endpoint — Firestore-backed friend system
 * POST /api/friends/request     — send friend request
 * POST /api/friends/accept      — accept request
 * POST /api/friends/reject      — reject request
 * DELETE /api/friends/:uid      — remove friend
 * GET /api/friends              — list friends
 * GET /api/friends/requests     — pending incoming requests
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

// POST /api/friends/request — send friend request
router.post("/friends/request", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { targetUid } = req.body;
    if (!targetUid || targetUid === req.uid) {
      return res.status(400).json({ error: "Invalid target user" });
    }

    const db = await getDB();
    const col = db.collection("friendships");

    // Check if friendship already exists (either direction)
    const existing = await col
      .where("participants", "array-contains", req.uid)
      .get();

    for (const doc of existing.docs) {
      const d = doc.data();
      if (d.participants.includes(targetUid)) {
        if (d.status === "accepted") return res.status(409).json({ error: "Already friends" });
        if (d.status === "pending") return res.status(409).json({ error: "Request already pending" });
      }
    }

    // Check target user exists
    const targetSnap = await db.collection("users").doc(targetUid).get();
    if (!targetSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    await col.add({
      from: req.uid,
      to: targetUid,
      participants: [req.uid, targetUid],
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    logger.info("Friend request sent", { from: req.uid, to: targetUid });
    return res.json({ ok: true });
  } catch (err) {
    logger.error("Friend request failed", { error: err });
    return res.status(500).json({ error: "Failed to send request" });
  }
});

// POST /api/friends/accept — accept friend request
router.post("/friends/accept", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: "Missing requestId" });

    const db = await getDB();
    const ref = db.collection("friendships").doc(requestId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Request not found" });

    const data = snap.data()!;
    if (data.to !== req.uid) return res.status(403).json({ error: "Not your request" });
    if (data.status !== "pending") return res.status(400).json({ error: "Request not pending" });

    await ref.update({ status: "accepted", acceptedAt: new Date().toISOString() });
    logger.info("Friend request accepted", { id: requestId });
    return res.json({ ok: true });
  } catch (err) {
    logger.error("Accept friend failed", { error: err });
    return res.status(500).json({ error: "Failed to accept" });
  }
});

// POST /api/friends/reject — reject friend request
router.post("/friends/reject", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: "Missing requestId" });

    const db = await getDB();
    const ref = db.collection("friendships").doc(requestId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Request not found" });

    const data = snap.data()!;
    if (data.to !== req.uid) return res.status(403).json({ error: "Not your request" });

    await ref.delete();
    logger.info("Friend request rejected", { id: requestId });
    return res.json({ ok: true });
  } catch (err) {
    logger.error("Reject friend failed", { error: err });
    return res.status(500).json({ error: "Failed to reject" });
  }
});

// DELETE /api/friends/:uid — remove friend
router.delete("/friends/:uid", authMiddleware, async (req: Request, res: Response) => {
  try {
    const targetUid = req.params.uid;
    const db = await getDB();
    const col = db.collection("friendships");

    const snap = await col
      .where("participants", "array-contains", req.uid)
      .where("status", "==", "accepted")
      .get();

    let deleted = false;
    for (const doc of snap.docs) {
      if (doc.data().participants.includes(targetUid)) {
        await doc.ref.delete();
        deleted = true;
        break;
      }
    }

    if (!deleted) return res.status(404).json({ error: "Friendship not found" });
    logger.info("Friend removed", { uid: req.uid, target: targetUid });
    return res.json({ ok: true });
  } catch (err) {
    logger.error("Remove friend failed", { error: err });
    return res.status(500).json({ error: "Failed to remove friend" });
  }
});

// GET /api/friends — list accepted friends
router.get("/friends", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();
    const snap = await db.collection("friendships")
      .where("participants", "array-contains", req.uid)
      .where("status", "==", "accepted")
      .get();

    const friendUids = snap.docs.map(d => {
      const p = d.data().participants as string[];
      return p.find(u => u !== req.uid)!;
    });

    // Fetch profiles
    const friends = [];
    for (const uid of friendUids) {
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.exists) {
        const u = userSnap.data()!;
        friends.push({ uid, displayName: u.displayName, username: u.username, avatar: u.avatar });
      }
    }

    return res.json({ friends });
  } catch (err) {
    logger.error("List friends failed", { error: err });
    return res.status(500).json({ error: "Failed to list friends" });
  }
});

// GET /api/friends/requests — pending incoming requests
router.get("/friends/requests", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();
    const snap = await db.collection("friendships")
      .where("to", "==", req.uid)
      .where("status", "==", "pending")
      .get();

    const requests = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      const fromSnap = await db.collection("users").doc(d.from).get();
      const from = fromSnap.exists ? fromSnap.data()! : {};
      requests.push({
        id: doc.id,
        fromUid: d.from,
        displayName: from.displayName || "Unknown",
        username: from.username || "",
        avatar: from.avatar || "😊",
        createdAt: d.createdAt,
      });
    }

    return res.json({ requests });
  } catch (err) {
    logger.error("List requests failed", { error: err });
    return res.status(500).json({ error: "Failed to list requests" });
  }
});

export default router;
