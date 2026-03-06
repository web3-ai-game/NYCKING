/**
 * Admin endpoint — stats and user management (admin tier only)
 * GET /api/admin/stats  — total users, usage counts
 * GET /api/admin/users  — user list with usage info
 * POST /api/admin/set-tier — set user tier
 * POST /api/activate — activate a Pro code
 * POST /api/apply-invite — apply an invite code for referral bonus
 * POST /api/admin/seed-codes — seed activation codes (admin only)
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { authMiddleware } from "../middleware/authMiddleware";
import * as admin from "firebase-admin";

const router = Router();

// Pro activation duration
const PRO_DURATION_DAYS = 30;
const PRO_DURATION_MS = PRO_DURATION_DAYS * 24 * 60 * 60 * 1000;

let firestore: FirebaseFirestore.Firestore | null = null;

async function getDB(): Promise<FirebaseFirestore.Firestore> {
  if (firestore) return firestore;
  if (!admin.apps.length) admin.initializeApp();
  firestore = admin.firestore();
  return firestore;
}

// Admin emails that get auto-elevated
const ADMIN_EMAILS = ["admin@nycking.com", "admin2@nycking.com"];

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
    let totalUsageCount = 0;
    let proUsers = 0;
    let adminUsers = 0;

    usersSnap.docs.forEach((doc) => {
      const d = doc.data();
      totalUsers++;
      totalUsageCount += d.usageCount || 0;
      if (d.tier === "pro") proUsers++;
      if (d.tier === "admin") adminUsers++;
    });

    return res.json({
      totalUsers,
      proUsers,
      adminUsers,
      freeUsers: totalUsers - proUsers - adminUsers,
      totalUsageCount,
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
      usageCount: doc.data().usageCount ?? 0,
      usageLimit: doc.data().usageLimit ?? 1000,
      inviteCode: doc.data().inviteCode || "",
      inviteCount: doc.data().inviteCount || 0,
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
    if (tier === "pro" || tier === "admin") {
      updates.usageLimit = -1; // unlimited
    }
    if (tier === "free") {
      updates.usageLimit = 1000;
    }
    await db.collection("users").doc(uid).update(updates);
    logger.info("Admin set tier", { uid, tier, by: req.uid });
    return res.json({ ok: true, uid, tier });
  } catch (err) {
    logger.error("Admin set-tier failed", { error: err });
    return res.status(500).json({ error: "Failed to set tier" });
  }
});

// POST /api/admin/seed-codes — seed activation codes (admin only)
router.post("/admin/seed-codes", authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!(await checkAdmin(req, res))) return;
    const db = await getDB();
    const codes = [
      "NYCKING-PRO-2026-AAAA", "NYCKING-PRO-2026-BBBB", "NYCKING-PRO-2026-CCCC",
      "NYCKING-PRO-2026-DDDD", "NYCKING-PRO-2026-EEEE", "NYCKING-PRO-2026-FFFF",
      "NYCKING-PRO-2026-GGGG", "NYCKING-PRO-2026-HHHH", "NYCKING-PRO-2026-IIII",
      "NYCKING-PRO-2026-JJJJ", "NYCKING-PRO-2026-KKKK", "NYCKING-PRO-2026-LLLL",
      "NYCKING-PRO-2026-MMMM", "NYCKING-PRO-2026-NNNN", "NYCKING-PRO-2026-OOOO",
      "NYCKING-PRO-2026-PPPP", "NYCKING-PRO-2026-QQQQ", "NYCKING-PRO-2026-RRRR",
      "NYCKING-PRO-2026-SSSS", "NYCKING-PRO-2026-TTTT",
    ];
    const batch = db.batch();
    for (const code of codes) {
      const ref = db.collection("activation_codes").doc(code);
      batch.set(ref, { code, used: false, usedBy: "", usedAt: null, createdAt: new Date().toISOString() }, { merge: true });
    }
    await batch.commit();
    logger.info("Admin seeded activation codes", { count: codes.length, by: req.uid });
    return res.json({ ok: true, count: codes.length });
  } catch (err) {
    logger.error("Admin seed-codes failed", { error: err });
    return res.status(500).json({ error: "Failed to seed codes" });
  }
});

// POST /api/activate — redeem an activation code for Pro access
router.post("/activate", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Missing activation code" });
    }
    const normalizedCode = code.trim().toUpperCase();
    const db = await getDB();
    const codeRef = db.collection("activation_codes").doc(normalizedCode);
    const codeSnap = await codeRef.get();

    if (!codeSnap.exists) {
      return res.status(404).json({ error: "Invalid activation code" });
    }
    const codeData = codeSnap.data();
    if (codeData?.used) {
      return res.status(409).json({ error: "This activation code has already been used" });
    }

    // Mark code as used
    const now = new Date();
    const proExpiresAt = new Date(now.getTime() + PRO_DURATION_MS);
    await codeRef.update({
      used: true,
      usedBy: req.uid,
      usedAt: now.toISOString(),
    });

    // Upgrade user to Pro
    await db.collection("users").doc(req.uid!).update({
      tier: "pro",
      usageLimit: -1, // unlimited
      proExpiresAt: proExpiresAt.toISOString(),
    });

    logger.info("Activation code redeemed", { code: normalizedCode, uid: req.uid, expiresAt: proExpiresAt.toISOString() });
    return res.json({ ok: true, tier: "pro", expiresAt: proExpiresAt.toISOString() });
  } catch (err) {
    logger.error("Activation failed", { error: err });
    return res.status(500).json({ error: "Activation failed" });
  }
});

// POST /api/apply-invite — apply a referral invite code
router.post("/apply-invite", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Missing invite code" });
    }
    const normalizedCode = code.trim().toUpperCase();
    const db = await getDB();
    const uid = req.uid!;

    // Find the user who owns this invite code
    const inviterSnap = await db.collection("users").where("inviteCode", "==", normalizedCode).limit(1).get();
    if (inviterSnap.empty) {
      return res.status(404).json({ error: "Invalid invite code" });
    }

    const inviterDoc = inviterSnap.docs[0];
    const inviterUid = inviterDoc.id;

    // Can't invite yourself
    if (inviterUid === uid) {
      return res.status(400).json({ error: "Cannot use your own invite code" });
    }

    // Check if this user already used an invite code
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userSnap.data();
    if (userData?.invitedBy) {
      return res.status(409).json({ error: "You have already used an invite code" });
    }

    // Check if already referred by checking referrals collection
    const existingRef = await db.collection("referrals")
      .where("inviteeUid", "==", uid)
      .limit(1)
      .get();
    if (!existingRef.empty) {
      return res.status(409).json({ error: "You have already been referred" });
    }

    // Record the referral
    await db.collection("referrals").add({
      inviterUid,
      inviteeUid: uid,
      code: normalizedCode,
      createdAt: new Date().toISOString(),
    });

    // Reward BOTH users: inviter gets +3000 uses, invitee gets +3000 uses
    const increment = admin.firestore.FieldValue.increment;

    // Update inviter: +3000 usage limit, +1 invite count
    await db.collection("users").doc(inviterUid).update({
      usageLimit: increment(3000),
      inviteCount: increment(1),
    });

    // Update invitee: +3000 usage limit, set invitedBy
    await db.collection("users").doc(uid).update({
      usageLimit: increment(3000),
      invitedBy: inviterUid,
    });

    logger.info("Invite applied", { inviterUid, inviteeUid: uid, code: normalizedCode });
    return res.json({ ok: true, bonusUses: 3000 });
  } catch (err) {
    logger.error("Apply invite failed", { error: err });
    return res.status(500).json({ error: "Failed to apply invite code" });
  }
});

export default router;
