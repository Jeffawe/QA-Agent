#!/bin/bash
set -e  # stop on first error

CONTAINER_NAME="qa-agent"
IMAGE_NAME="qa-agent"

echo "📥 Pulling latest code..."
git pull origin main

echo "🛑 Stopping and removing old container..."
docker rm -f $CONTAINER_NAME || true

echo "🐳 Building new Docker image..."
docker build -t $IMAGE_NAME .

echo "🚀 Starting new container..."
docker run -d --name $CONTAINER_NAME \
  --network host \
  --env-file .env \
  $IMAGE_NAME

echo "✅ Deployment complete!"
docker ps --filter "name=$CONTAINER_NAME"