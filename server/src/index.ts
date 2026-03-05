/**
 * NYCKING Cloud Run Server
 * Thai-Chinese Real-time Voice Translator Backend
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config, validateConfig } from "./config";
import { logger } from "./logger";
import { apiLimiter } from "./middleware/rateLimiter";
import { trackUsage, initFirestore } from "./middleware/usageTracker";
import tokenRouter from "./routes/token";
import translateRouter from "./routes/translate";
import chatRouter from "./routes/chat";
import coachRouter from "./routes/coach";
import healthRouter from "./routes/health";

// Validate required config before starting
validateConfig();

const app = express();

// Trust Cloud Run proxy
app.set("trust proxy", true);

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// CORS
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (config.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // In dev, allow all localhost
      if (config.nodeEnv !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin)) {
        return callback(null, true);
      }
      logger.warn("CORS blocked", { origin });
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400,
  })
);

// Body parser
app.use(express.json({ limit: "1mb" }));

// Rate limiting on API routes
app.use("/api", apiLimiter);

// Usage tracking
app.use("/api", trackUsage);

// Routes
app.use("/api", tokenRouter);
app.use("/api", translateRouter);
app.use("/api", chatRouter);
app.use("/api", coachRouter);
app.use("/api", healthRouter);

// Root health check (for Cloud Run)
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "nycking-server" });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error("Unhandled error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Internal server error" });
  }
);

// Start server
async function start(): Promise<void> {
  // Initialize Firestore for usage tracking (non-blocking)
  initFirestore().catch((err) => {
    logger.warn("Firestore init failed, continuing without usage tracking", {
      error: err,
    });
  });

  app.listen(config.port, () => {
    logger.info(`NYCKING server started`, {
      port: config.port,
      env: config.nodeEnv,
      origins: config.allowedOrigins.length,
    });
  });
}

start().catch((err) => {
  logger.error("Failed to start server", { error: err });
  process.exit(1);
});
