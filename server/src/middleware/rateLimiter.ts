/**
 * Rate limiting middleware
 */

import rateLimit from "express-rate-limit";
import { config } from "../config";

export const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests",
    message: "请求过于频繁，请稍后再试 / Too many requests, please try again later",
    retryAfter: Math.ceil(config.rateLimitWindowMs / 1000),
  },
  keyGenerator: (req) => {
    // Use X-Forwarded-For on Cloud Run, fallback to IP
    return (
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "unknown"
    );
  },
});
