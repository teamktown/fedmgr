const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const { AdminUtils, SecurityUtils, ResponseUtils } = require('./utils/shared-utilities');

/**
 * OAuth Handler Module
 * Handles GitHub OAuth authentication flow and JWT token generation
 */
class OAuthHandler {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config.redirectUri;
    this.stateSecret = config.stateSecret;
    this.fedName = config.fedName;
    this.entityConfig = config.entityConfig;
    this.privateKey = config.privateKey;
    this.updateRegistry = config.updateRegistry;
  }

  /**
   * Validate OAuth configuration
   */
  validateConfig() {
    if (!this.clientId || !this.clientSecret) {
      return {
        valid: false,
        error: 'GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.'
      };
    }
    return { valid: true };
  }

  /**
   * Generate OAuth state token
   */
  generateStateToken() {
    const state = SecurityUtils.generateSecureRandom(16);
    return jwt.sign({ state, fed: this.fedName }, this.stateSecret, { expiresIn: '10m' });
  }

  /**
   * Verify OAuth state token
   */
  verifyStateToken(stateToken) {
    try {
      const verified = jwt.verify(stateToken, this.stateSecret);
      if (!verified || verified.fed !== this.fedName) {
        throw new Error('Invalid federation in state token');
      }
      return { valid: true, data: verified };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Exchange OAuth code for access token
   */
  async exchangeCodeForToken(code) {
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: this.redirectUri,
        }),
      });

      const tokenData = await response.json();
      
      if (!tokenData.access_token) {
        throw new Error(tokenData.error_description || 'Token exchange failed');
      }

      return { success: true, access_token: tokenData.access_token };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch GitHub user information
   */
  async fetchGitHubUser(accessToken) {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'fedmgr',
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const user = await response.json();
      return { success: true, user };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create federation JWT token for authenticated user
   */
  createFederationToken(user) {
    const now = Math.floor(Date.now() / 1000);
    const userIsAdmin = AdminUtils.isAdminUser(user.login);
    const adminClaims = AdminUtils.getAdminClaims(userIsAdmin);

    // Create trust mark for GitHub verified user
    const trustMark = jwt.sign({
      iss: this.entityConfig.sub,
      sub: `github:${user.id}`,
      trust_mark_id: `${this.entityConfig.sub}/trust-marks/github-verified`,
      iat: now,
      exp: now + 86400, // 24 hours
    }, this.privateKey, { 
      algorithm: 'RS256'
      // Note: Not setting expiresIn since payload contains manual exp
    });

    // Create main federation token
    const tokenPayload = {
      iss: this.entityConfig.sub,
      sub: `github:${user.id}`,
      aud: ['mcp-demo', 'mcp-server'],
      iat: now,
      exp: now + 3600, // 1 hour
      auth_time: now,
      nonce: SecurityUtils.generateNonce(),
      
      // User information
      preferred_username: user.login,
      name: user.name,
      email: user.email,
      picture: user.avatar_url,
      
      // Admin role claims
      ...adminClaims,
      
      // Federation-specific claims
      trust_chain: [this.entityConfig.sub],
      trust_marks: [{
        id: `${this.entityConfig.sub}/trust-marks/github-verified`,
        trust_mark: trustMark
      }],
      federation_entity: {
        authority_hints: [this.entityConfig.sub],
        trust_anchor_id: this.entityConfig.sub,
      },
      
      // GitHub-specific information
      github: {
        id: user.id,
        login: user.login,
        type: user.type,
        verified: true,
      },
    };

    return jwt.sign(tokenPayload, this.privateKey, {
      algorithm: 'RS256',
      keyid: this.entityConfig.jwks.keys[0].kid
      // Note: Not setting expiresIn since payload contains manual exp
    });
  }

  /**
   * Update user registry with new user information
   */
  updateUserRegistry(user, federationToken) {
    try {
      this.updateRegistry({
        users: {
          [user.id]: {
            github_id: user.id,
            login: user.login,
            federation_token: federationToken,
            trust_chain: [this.entityConfig.sub],
            created_at: new Date().toISOString(),
            last_login: new Date().toISOString(),
            admin: AdminUtils.isAdminUser(user.login)
          },
        },
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Register OAuth routes with Express app
   */
  registerRoutes(app) {
    // Login initiation endpoint
    app.get('/login', (req, res) => {
      const configCheck = this.validateConfig();
      if (!configCheck.valid) {
        return ResponseUtils.sendError(res, 500, 'Configuration Error', configCheck.error);
      }

      const stateToken = this.generateStateToken();
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(this.clientId)}&redirect_uri=${encodeURIComponent(this.redirectUri)}&state=${encodeURIComponent(stateToken)}&scope=read:user`;
      
      console.log(`🔗 Redirecting to GitHub OAuth: ${this.clientId}`);
      res.redirect(authUrl);
    });

    // OAuth callback endpoint
    app.get('/oauth/callback', async (req, res) => {
      try {
        const { code, state: stateToken } = req.query;

        if (!code || !stateToken) {
          return ResponseUtils.sendError(res, 400, 'Bad Request', 'Missing code or state parameter');
        }

        // Verify state token
        const stateVerification = this.verifyStateToken(stateToken);
        if (!stateVerification.valid) {
          return ResponseUtils.sendError(res, 401, 'Unauthorized', `Invalid state: ${stateVerification.error}`);
        }

        // Exchange code for access token
        const tokenExchange = await this.exchangeCodeForToken(code);
        if (!tokenExchange.success) {
          return ResponseUtils.sendError(res, 401, 'Unauthorized', `Token exchange failed: ${tokenExchange.error}`);
        }

        // Fetch user information
        const userFetch = await this.fetchGitHubUser(tokenExchange.access_token);
        if (!userFetch.success) {
          return ResponseUtils.sendError(res, 401, 'Unauthorized', `User fetch failed: ${userFetch.error}`);
        }

        const user = userFetch.user;

        // Create federation token
        const federationToken = this.createFederationToken(user);

        // Update registry
        const registryUpdate = this.updateUserRegistry(user, federationToken);
        if (!registryUpdate.success) {
          console.error('⚠️ Failed to update registry:', registryUpdate.error);
          // Continue anyway - don't fail the auth flow
        }

        // Log successful authentication
        const adminStatus = AdminUtils.isAdminUser(user.login) ? ' (ADMIN)' : '';
        console.log(`✅ Issued OIDCFed token for GitHub user: ${user.login}${adminStatus}`);

        // Redirect to frontend with token
        const redirectUrl = `/?token=${encodeURIComponent(federationToken)}&user=${encodeURIComponent(user.login)}`;
        res.redirect(redirectUrl);

      } catch (error) {
        console.error('❌ OAuth callback error:', error);
        ResponseUtils.sendError(res, 500, 'Internal Server Error', `Authentication failed: ${error.message}`);
      }
    });

    // OAuth status endpoint
    app.get('/oauth/status', (req, res) => {
      const configCheck = this.validateConfig();
      ResponseUtils.sendSuccess(res, {
        oauth_configured: configCheck.valid,
        client_id: this.clientId ? this.clientId.substring(0, 8) + '...' : null,
        redirect_uri: this.redirectUri,
        federation: this.fedName
      });
    });
  }
}

/**
 * Factory function to create OAuth handler
 */
function createOAuthHandler(config) {
  return new OAuthHandler(config);
}

module.exports = {
  OAuthHandler,
  createOAuthHandler
};