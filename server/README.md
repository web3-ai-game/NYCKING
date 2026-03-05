# NYCKING Server — Cloud Run Backend

Thai-Chinese Real-time Voice Translator API Server.

## Architecture

```
Firebase Hosting (static PWA)
  └── /api/* → Cloud Run (nycking-server, asia-southeast1)
                 ├── POST /api/token   → xAI ephemeral token (cached, retried)
                 ├── GET  /api/health  → health check
                 └── Middleware: CORS, rate-limit (30/min), usage tracking (Firestore)
```

## Local Development

```bash
# 1. Install dependencies
cd server && npm install

# 2. Create .env (copy from .env.example)
cp .env.example .env
# Edit .env and set XAI_API_KEY

# 3. Start dev server (auto-loads .env)
npm run dev
# → http://localhost:8080

# 4. Test
curl http://localhost:8080/api/health
curl -X POST http://localhost:8080/api/token
```

Then open the frontend (in another terminal):
```bash
cd public
npx serve -s .
# Frontend at localhost:5000, API auto-proxied to localhost:8080
```

## Deploy to Cloud Run

### Prerequisites
- `gcloud` CLI authenticated with project `ai-oece`
- Docker (or Cloud Build)

### Step 1: Store API Key in Secret Manager
```bash
echo -n "YOUR_XAI_API_KEY" | gcloud secrets create XAI_API_KEY \
  --replication-policy="automatic" \
  --data-file=- \
  --project ai-oece
```

### Step 2: Deploy
```bash
chmod +x deploy.sh
./deploy.sh
```

Or manually:
```bash
# Build
gcloud builds submit --tag gcr.io/ai-oece/nycking-server --project ai-oece

# Deploy
gcloud run deploy nycking-server \
  --image gcr.io/ai-oece/nycking-server \
  --platform managed \
  --region asia-southeast1 \
  --project ai-oece \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 10 \
  --memory 256Mi \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=ai-oece" \
  --update-secrets "XAI_API_KEY=XAI_API_KEY:latest"
```

### Step 3: Deploy Firebase Hosting
```bash
cd .. && firebase deploy --only hosting
```

## API Endpoints

### `POST /api/token`
Returns an xAI ephemeral client secret for WebSocket connection.

**Response:**
```json
{
  "value": "xai-realtime-client-secret-...",
  "expires_at": 1772693455,
  "cached": false
}
```

### `GET /api/health`
```json
{
  "status": "ok",
  "service": "nycking-server",
  "uptime": 3600,
  "timestamp": "2026-03-05T06:00:00.000Z"
}
```

## Key Features

- **Token caching** — Server-side cache, refreshes 60s before expiry
- **Retry with backoff** — 3 retries on xAI API failure
- **Rate limiting** — 30 req/min per IP
- **Usage tracking** — Batched writes to Firestore `nycking_usage` collection
- **Structured logging** — JSON format for Cloud Logging
- **Min instances = 1** — No cold start penalty
