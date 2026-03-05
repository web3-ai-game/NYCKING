/**
 * Users endpoint — profile CRUD with Firestore
 * GET  /api/users/me        — get current user profile
 * PATCH /api/users/me       — update profile (displayName, username, avatar, bio, lang)
 * GET  /api/users/search?q= — search users by username
 * GET  /api/users/:uid      — get public profile
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

// GET /api/users/me
router.get("/users/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();
    const snap = await db.collection("users").doc(req.uid!).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Profile not found" });
    }
    return res.json({ uid: req.uid, ...snap.data() });
  } catch (err) {
    logger.error("Get profile failed", { error: err });
    return res.status(500).json({ error: "Failed to get profile" });
  }
});

// PATCH /api/users/me
router.patch("/users/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { displayName, username, avatar, bio, lang } = req.body;
    const updates: Record<string, string> = {};

    if (displayName && typeof displayName === "string") updates.displayName = displayName.slice(0, 30);
    if (avatar && typeof avatar === "string") updates.avatar = avatar.slice(0, 10);
    if (bio && typeof bio === "string") updates.bio = bio.slice(0, 200);
    if (lang && typeof lang === "string") updates.lang = lang;

    // Username uniqueness check
    if (username && typeof username === "string") {
      const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
      if (clean.length < 3) {
        return res.status(400).json({ error: "Username must be 3+ chars (a-z, 0-9, _)" });
      }
      const db = await getDB();
      const existing = await db.collection("users").where("username", "==", clean).get();
      const isOwnUsername = existing.docs.length === 1 && existing.docs[0].id === req.uid;
      if (!existing.empty && !isOwnUsername) {
        return res.status(409).json({ error: "Username already taken" });
      }
      updates.username = clean;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const db = await getDB();
    await db.collection("users").doc(req.uid!).update(updates);
    logger.info("Profile updated", { uid: req.uid, fields: Object.keys(updates) });
    return res.json({ ok: true, updated: updates });
  } catch (err) {
    logger.error("Update profile failed", { error: err });
    return res.status(500).json({ error: "Failed to update profile" });
  }
});

// GET /api/users/search?q=username
router.get("/users/search", authMiddleware, async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || "").toLowerCase().trim();
    if (!q || q.length < 2) {
      return res.status(400).json({ error: "Query must be 2+ chars" });
    }
    const db = await getDB();
    const snap = await db
      .collection("users")
      .where("username", ">=", q)
      .where("username", "<=", q + "\uf8ff")
      .limit(10)
      .get();

    const results = snap.docs.map((d) => ({
      uid: d.id,
      displayName: d.data().displayName,
      username: d.data().username,
      avatar: d.data().avatar,
    }));
    return res.json({ results });
  } catch (err) {
    logger.error("Search users failed", { error: err });
    return res.status(500).json({ error: "Search failed" });
  }
});

// GET /api/users/:uid
router.get("/users/:uid", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = await getDB();
    const snap = await db.collection("users").doc(req.params.uid).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "User not found" });
    }
    const data = snap.data()!;
    return res.json({
      uid: req.params.uid,
      displayName: data.displayName,
      username: data.username,
      avatar: data.avatar,
      bio: data.bio,
    });
  } catch (err) {
    logger.error("Get user failed", { error: err });
    return res.status(500).json({ error: "Failed to get user" });
  }
});

export default router;
