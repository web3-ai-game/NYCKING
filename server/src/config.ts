/**
 * Server configuration — all secrets from environment variables
 */

export const config = {
  port: parseInt(process.env.PORT || "8080", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // xAI API
  xaiApiKey: process.env.XAI_API_KEY || "",

  // Gemini API
  geminiApiKey: process.env.GEMINI_API_KEY || "",

  // Firebase (optional, for usage tracking)
  gcpProjectId: process.env.GCP_PROJECT_ID || "ai-oece",

  // CORS
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .filter(Boolean)
    .concat([
      "https://nycking.web.app",
      "https://nycking.firebaseapp.com",
      "https://ai-oece.web.app",
      "https://ai-oece.firebaseapp.com",
      "http://localhost:5000",
      "http://localhost:8080",
      "http://127.0.0.1:5000",
    ]),

  // Rate limiting
  rateLimitWindowMs: 60 * 1000, // 1 minute
  rateLimitMax: 30, // 30 requests per minute per IP

  // Token settings
  tokenTtlSeconds: 300, // 5 minutes
};

export function validateConfig(): void {
  if (!config.xaiApiKey) {
    throw new Error("FATAL: XAI_API_KEY environment variable is required");
  }
}
