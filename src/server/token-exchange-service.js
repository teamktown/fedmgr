/**
 * Token Exchange Service
 * 
 * This service handles token exchange between different authentication providers
 * and the federation. It converts GitHub OAuth tokens to federation-compatible tokens.
 */

const express = require('express');
const http = require('http');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

class TokenExchangeService {
  constructor(options = {}) {
    this.port = options.port || 3457;
    this.app = express();
    this.server = null;
    this.federationAdminUrl = options.federationAdminUrl || 'http://localhost:3001';
    this.githubClientId = options.githubClientId || 'fedmgr-github-client';
    this.githubClientSecret = options.githubClientSecret || 'github-client-secret';
    
    // Set up middleware
    this.app.use(express.json());
    
    // Set up routes
    this.setupRoutes();
  }
  
  /**
   * Set up Express routes
   */
  setupRoutes() {
    // Token exchange endpoint
    this.app.post('/token-exchange', async (req, res) => {
      try {
        const { code, client_id, redirect_uri, provider } = req.body;
        
        if (!code || !provider) {
          return res.status(400).json({ error: 'Missing required parameters' });
        }
        
        let token;
        
        if (provider === 'github') {
          token = await this.exchangeGitHubCode(code, client_id, redirect_uri);
        } else {
          return res.status(400).json({ error: `Unsupported provider: ${provider}` });
        }
        
        // Convert to federation token
        const federationToken = await this.convertToFederationToken(token, provider);
        
        res.json(federationToken);
      } catch (error) {
        console.error(`Token exchange error: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'token-exchange-service'
      });
    });
  }
  
  /**
   * Exchange GitHub code for token
   * @param {string} code - Authorization code from GitHub
   * @param {string} clientId - GitHub OAuth client ID
   * @param {string} redirectUri - Redirect URI used in the OAuth flow
   * @returns {Promise<Object>} - GitHub token response
   */
  async exchangeGitHubCode(code, clientId, redirectUri) {
    const tokenUrl = 'https://github.com/login/oauth/access_token';
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId || this.githubClientId,
        client_secret: this.githubClientSecret,
        code,
        redirect_uri: redirectUri
      })
    });
    
    if (!response.ok) {
      throw new Error(`GitHub token exchange failed: ${response.statusText}`);
    }
    
    const tokenData = await response.json();
    
    if (tokenData.error) {
      throw new Error(`GitHub token exchange failed: ${tokenData.error_description || tokenData.error}`);
    }
    
    return tokenData;
  }
  
  /**
   * Convert a provider token to a federation token
   * @param {Object} token - Provider token
   * @param {string} provider - Provider name
   * @returns {Promise<Object>} - Federation token
   */
  async convertToFederationToken(token, provider) {
    // In a real implementation, this would:
    // 1. Validate the provider token
    // 2. Fetch user information from the provider
    // 3. Register the user with the federation if needed
    // 4. Generate a federation token
    
    // For this demo, we'll create a simple federation token
    const federationToken = {
      access_token: token.access_token,
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: this.createMockIdToken(token, provider),
      scope: 'openid profile'
    };
    
    return federationToken;
  }
  
  /**
   * Create a mock ID token for demonstration purposes
   * @param {Object} token - Provider token
   * @param {string} provider - Provider name
   * @returns {string} - JWT ID token
   */
  createMockIdToken(token, provider) {
    // In a real implementation, this would be signed with the federation's private key
    // and would contain proper claims
    
    // For this demo, we'll create a simple JWT
    const payload = {
      iss: this.federationAdminUrl,
      sub: `${provider}-user-123`,
      aud: 'fedmgr-cli',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      auth_time: Math.floor(Date.now() / 1000),
      nonce: 'mock-nonce',
      provider,
      federation: {
        trust_chain: ['fed-alpha']
      }
    };
    
    // Sign with a mock key (in a real implementation, this would be the federation's private key)
    const privateKeyPath = path.resolve(__dirname, '../../federations/alpha/keys/anchor-private.pem');
    let privateKey;
    
    try {
      privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    } catch (error) {
      // If the federation key doesn't exist, use a mock key
      privateKey = 'mock-key';
    }
    
    return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
  }
  
  /**
   * Start the token exchange service
   * @returns {Promise} - Promise that resolves when the server is started
   */
  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`🔄 Token Exchange Service running on http://localhost:${this.port}`);
        resolve();
      });
    });
  }
  
  /**
   * Stop the token exchange service
   * @returns {Promise} - Promise that resolves when the server is stopped
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Token Exchange Service stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = TokenExchangeService;

// If this file is run directly, start the service
if (require.main === module) {
  const service = new TokenExchangeService();
  service.start();
}
