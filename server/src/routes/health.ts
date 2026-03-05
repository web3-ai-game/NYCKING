/**
 * Health check endpoint for Cloud Run
 */

import { Router, Request, Response } from "express";

const router = Router();

const startTime = Date.now();

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "nycking-server",
    uptime: Math.round((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});

export default router;
