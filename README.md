# Federation MCP Demo

This project demonstrates a federated MCP (Model Context Protocol) system with GitHub OAuth integration and OpenID Federation (OIDCFed) trust chains.

## Features

- 🔐 GitHub OAuth authentication
- 🛰️ Federation trust management
- 🤖 MCP server with federation JWT validation
- 🐳 Docker-based deployment
- 📊 Federation admin interface

## Quick Start

1. **Setup GitHub OAuth App**
   - Go to GitHub Settings > Developer settings > OAuth Apps
   - Create new OAuth app with callback URL: `http://localhost:3001/oauth/callback`
   - Note the Client ID and Client Secret

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your GitHub OAuth credentials
