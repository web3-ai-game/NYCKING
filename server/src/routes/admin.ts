/**
 * Admin endpoint — stats and user management (admin tier only)
 * GET /api/admin/stats  — total users, token usage
 * GET /api/admin/users  — user list with balances
 * POST /api/admin/set-tier — set user tier
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

async function checkAdmin(req: Request, res: Response): Promise<boolean> {
  const db = await getDB();
  const snap = await db.collection("users").doc(req.uid!).get();
  if (!snap.exists || snap.data()?.tier !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

// GET /api/admin/stats
router.get("/admin/stats", authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!(await checkAdmin(req, res))) return;
    const db = await getDB();
    const usersSnap = await db.collection("users").get();
    let totalUsers = 0;
    let totalTokenUsed = 0;
    let totalTokenBalance = 0;
    let proUsers = 0;
    let adminUsers = 0;

    usersSnap.docs.forEach((doc) => {
      const d = doc.data();
      totalUsers++;
      totalTokenUsed += d.tokenUsed || 0;
      totalTokenBalance += d.tokenBalance || 0;
      if (d.tier === "pro") proUsers++;
      if (d.tier === "admin") adminUsers++;
    });

    return res.json({
      totalUsers,
      proUsers,
      adminUsers,
      freeUsers: totalUsers - proUsers - adminUsers,
      totalTokenUsed,
      totalTokenBalance,
    });
  } catch (err) {
    logger.error("Admin stats failed", { error: err });
    return res.status(500).json({ error: "Failed to get stats" });
  }
});

// GET /api/admin/users
router.get("/admin/users", authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!(await checkAdmin(req, res))) return;
    const db = await getDB();
    const snap = await db.collection("users").orderBy("createdAt", "desc").limit(100).get();
    const users = snap.docs.map((doc) => ({
      uid: doc.id,
      displayName: doc.data().displayName,
      username: doc.data().username,
      email: doc.data().email,
      avatar: doc.data().avatar,
      tier: doc.data().tier || "free",
      tokenBalance: doc.data().tokenBalance ?? 0,
      tokenUsed: doc.data().tokenUsed ?? 0,
    }));
    return res.json({ users });
  } catch (err) {
    logger.error("Admin users failed", { error: err });
    return res.status(500).json({ error: "Failed to get users" });
  }
});

// POST /api/admin/set-tier — { uid, tier }
router.post("/admin/set-tier", authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!(await checkAdmin(req, res))) return;
    const { uid, tier } = req.body;
    if (!uid || !["free", "pro", "admin"].includes(tier)) {
      return res.status(400).json({ error: "Invalid uid or tier" });
    }
    const db = await getDB();
    const updates: Record<string, unknown> = { tier };
    if (tier === "pro") updates.tokenBalance = 100000;
    if (tier === "admin") updates.tokenBalance = 999999;
    await db.collection("users").doc(uid).update(updates);
    logger.info("Admin set tier", { uid, tier, by: req.uid });
    return res.json({ ok: true, uid, tier });
  } catch (err) {
    logger.error("Admin set-tier failed", { error: err });
    return res.status(500).json({ error: "Failed to set tier" });
  }
});

export default router;
