#!/bin/bash

# Complete setup script for the federation demo

set -e

echo "🚀 Setting up Federation Demo..."

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Please create one from .env.example"
    echo "   cp .env.example .env"
    echo "   # Edit .env with your GitHub OAuth credentials"
    exit 1
fi

# Source environment variables
source .env

# Check required environment variables
if [ -z "$GITHUB_CLIENT_ID" ] || [ -z "$GITHUB_CLIENT_SECRET" ]; then
    echo "❌ Missing required environment variables:"
    echo "   GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set in .env"
    exit 1
fi

# Build npm packages
echo "�� Building npm packages..."
./scripts/build-npm.sh

# Clean up any existing containers and volumes
echo "🧹 Cleaning up existing containers..."
docker-compose down -v

# Initialize volumes with proper permissions
echo "🔧 Initializing volumes..."
docker-compose run --rm volume-init

# Start the services
echo "🚀 Starting services..."
docker-compose up --build -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check service health
echo "🏥 Checking service health..."
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ Federation Admin is healthy"
else
    echo "❌ Federation Admin is not responding"
fi

if curl -f http://localhost:4001/health > /dev/null 2>&1; then
    echo "✅ MCP Server is healthy"
else
    echo "❌ MCP Server is not responding"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📖 Next steps:"
echo "   1. Open http://localhost:3001 in your browser"
echo "   2. Click 'Login with GitHub'"
echo "   3. Test the MCP API integration"
echo ""
echo "🔍 View logs:"
echo "   docker-compose logs -f federation-admin"
echo "   docker-compose logs -f mcp-server"
echo ""
echo "🛑 Stop services:"
echo "   docker-compose down"
