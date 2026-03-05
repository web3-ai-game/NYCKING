/**
 * Token endpoint — proxies xAI API key → ephemeral client secret
 * with caching, retry, and proper error handling
 */

import { Router, Request, Response } from "express";
import fetch from "node-fetch";
import { config } from "../config";
import { logger } from "../logger";

const router = Router();

// Server-side token cache (shared across requests)
interface CachedToken {
  value: string;
  expiresAt: number; // unix seconds
}

let tokenCache: CachedToken | null = null;
const CACHE_MARGIN_SECONDS = 60; // refresh 60s before expiry

async function fetchEphemeralToken(retries = 3): Promise<{ value: string; expires_at: number }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.xaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_after: { seconds: config.tokenTtlSeconds },
        }),
        timeout: 10000,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("xAI API error", {
          status: response.status,
          body: errorText,
          attempt,
        });

        // Don't retry on 4xx (client errors)
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`xAI API ${response.status}: ${errorText}`);
        }

        // Retry on 5xx
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`xAI API failed after ${retries} attempts`);
      }

      const data = await response.json() as Record<string, unknown>;
      const value =
        (data.value as string) ||
        ((data.client_secret as Record<string, string>)?.value);

      if (!value) {
        throw new Error("Invalid token response format");
      }

      const expiresAt =
        (data.expires_at as number) || Date.now() / 1000 + config.tokenTtlSeconds;

      return { value, expires_at: expiresAt };
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      logger.warn(`Token fetch attempt ${attempt} failed, retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error("Token fetch exhausted all retries");
}

router.post("/token", async (_req: Request, res: Response) => {
  try {
    // Check cache
    const now = Date.now() / 1000;
    if (tokenCache && tokenCache.expiresAt - now > CACHE_MARGIN_SECONDS) {
      logger.debug("Returning cached token", {
        remainingSec: Math.round(tokenCache.expiresAt - now),
      });
      return res.json({
        value: tokenCache.value,
        expires_at: tokenCache.expiresAt,
        cached: true,
      });
    }

    // Fetch new token
    const startMs = Date.now();
    const token = await fetchEphemeralToken();
    const latency = Date.now() - startMs;

    // Update cache
    tokenCache = { value: token.value, expiresAt: token.expires_at };

    logger.info("New ephemeral token issued", {
      latencyMs: latency,
      expiresAt: new Date(token.expires_at * 1000).toISOString(),
    });

    return res.json({
      value: token.value,
      expires_at: token.expires_at,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Token endpoint failed", { error: message });
    return res.status(502).json({
      error: "Failed to obtain ephemeral token",
      message,
    });
  }
});

export default router;
