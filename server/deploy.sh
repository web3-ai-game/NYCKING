#!/bin/bash
# NYCKING Cloud Run Deployment Script
# Usage: ./deploy.sh [--set-secret]

set -e

PROJECT_ID="ai-oece"
REGION="asia-southeast1"
SERVICE_NAME="nycking-server"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "=== NYCKING Cloud Run Deploy ==="
echo "Project: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Service: ${SERVICE_NAME}"
echo ""

# Build and push Docker image
echo "📦 Building Docker image..."
gcloud builds submit --tag "${IMAGE}" --project "${PROJECT_ID}"

# Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 10 \
  --memory 256Mi \
  --cpu 1 \
  --timeout 60 \
  --set-env-vars "NODE_ENV=production,GCP_PROJECT_ID=${PROJECT_ID}" \
  --update-secrets "XAI_API_KEY=XAI_API_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest"

echo ""
echo "✅ Deployed! Getting service URL..."
URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format "value(status.url)")

echo "🌐 Service URL: ${URL}"
echo ""
echo "📋 Next steps:"
echo "  1. Test: curl ${URL}/api/health"
echo "  2. Deploy hosting: firebase deploy --only hosting"
echo ""

# If --set-secret flag, create the secrets first
if [ "$1" == "--set-secret" ]; then
  echo "🔑 Creating XAI_API_KEY secret..."
  echo "Enter your xAI API key:"
  read -s API_KEY
  echo -n "${API_KEY}" | gcloud secrets create XAI_API_KEY \
    --replication-policy="automatic" \
    --data-file=- \
    --project "${PROJECT_ID}" 2>/dev/null || \
  echo -n "${API_KEY}" | gcloud secrets versions add XAI_API_KEY \
    --data-file=- \
    --project "${PROJECT_ID}"
  echo "✅ XAI_API_KEY stored in Secret Manager"

  echo ""
  echo "🔑 Creating GEMINI_API_KEY secret..."
  echo "Enter your Gemini API key:"
  read -s GEMINI_KEY
  echo -n "${GEMINI_KEY}" | gcloud secrets create GEMINI_API_KEY \
    --replication-policy="automatic" \
    --data-file=- \
    --project "${PROJECT_ID}" 2>/dev/null || \
  echo -n "${GEMINI_KEY}" | gcloud secrets versions add GEMINI_API_KEY \
    --data-file=- \
    --project "${PROJECT_ID}"
  echo "✅ GEMINI_API_KEY stored in Secret Manager"
fi
