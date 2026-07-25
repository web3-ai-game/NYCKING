/**
 * Usage tracking middleware — logs token requests to Firestore
 * Ready for future billing integration
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

interface UsageRecord {
  timestamp: string;
  ip: string;
  userAgent: string;
  endpoint: string;
  status: number;
  latencyMs: number;
}

// In-memory buffer, flushed to Firestore periodically
const usageBuffer: UsageRecord[] = [];
const FLUSH_INTERVAL = 60_000; // 1 minute
const MAX_BUFFER = 500;

let firestore: FirebaseFirestore.Firestore | null = null;

export async function initFirestore(): Promise<void> {
  try {
    const admin = await import("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    firestore = admin.firestore();
    logger.info("Firestore initialized for usage tracking");
  } catch (err) {
    logger.warn("Firestore not available, usage tracking will be in-memory only", { error: err });
  }
}

async function flushBuffer(): Promise<void> {
  if (usageBuffer.length === 0 || !firestore) return;

  const batch = firestore.batch();
  const records = usageBuffer.splice(0, MAX_BUFFER);
  const collRef = firestore.collection("nycking_usage");

  for (const record of records) {
    batch.set(collRef.doc(), record);
  }

  try {
    await batch.commit();
    logger.debug(`Flushed ${records.length} usage records`);
  } catch (err) {
    logger.error("Failed to flush usage records", { error: err });
    // Put records back
    usageBuffer.unshift(...records);
  }
}

// Start flush timer
setInterval(flushBuffer, FLUSH_INTERVAL);

export function trackUsage(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const record: UsageRecord = {
      timestamp: new Date().toISOString(),
      ip:
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.ip ||
        "unknown",
      userAgent: req.headers["user-agent"] || "unknown",
      endpoint: req.path,
      status: res.statusCode,
      latencyMs: Date.now() - start,
    };

    usageBuffer.push(record);
    logger.info("API request", record);

    // Flush if buffer is getting large
    if (usageBuffer.length >= MAX_BUFFER) {
      flushBuffer().catch(() => {});
    }
  });

  next();
}
