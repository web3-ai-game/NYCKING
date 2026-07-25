const functions = require("firebase-functions");
const fetch = require("node-fetch");

/**
 * Cloud Function: /api/token
 * Proxies XAI_API_KEY → ephemeral client secret for Grok Realtime WebSocket.
 * The frontend never sees the real API key.
 */
exports.getEphemeralToken = functions
  .region("asia-southeast1")
  .https.onRequest(async (req, res) => {
    // CORS
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.XAI_API_KEY || functions.config().xai?.api_key;
    if (!apiKey) {
      console.error("XAI_API_KEY not configured");
      return res.status(500).json({ error: "API key not configured" });
    }

    try {
      const response = await fetch(
        "https://api.x.ai/v1/realtime/client_secrets",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expires_after: { seconds: 300 },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("xAI API error:", response.status, errorText);
        return res.status(response.status).json({
          error: "Failed to get ephemeral token",
          detail: errorText,
        });
      }

      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      console.error("Token fetch error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
