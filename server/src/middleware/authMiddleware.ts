/**
 * Firebase Auth middleware — verify ID token from Authorization header
 * Usage: app.use("/api/protected", authMiddleware);
 * Sets req.uid and req.userEmail on success
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

let adminAuth: import("firebase-admin").auth.Auth | null = null;

async function getAuth(): Promise<import("firebase-admin").auth.Auth> {
  if (adminAuth) return adminAuth;
  const admin = await import("firebase-admin");
  if (!admin.apps.length) admin.initializeApp();
  adminAuth = admin.auth();
  return adminAuth;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      uid?: string;
      userEmail?: string;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const auth = await getAuth();
    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    logger.warn("Auth token verification failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
