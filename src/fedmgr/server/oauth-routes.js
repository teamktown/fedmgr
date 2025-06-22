const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

function registerOAuthRoutes(app, opts) {
  const { clientId, clientSecret, redirectUri, stateSecret, fedName, entityConfig, privateKey, updateRegistry } = opts;

  app.get('/login', (req, res) => {
    if (!clientId || !clientSecret) {
      return res.status(500).send('GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
    }

    const state = crypto.randomBytes(16).toString('hex');
    const stateToken = jwt.sign({ state, fed: fedName }, stateSecret, { expiresIn: '10m' });

    const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(stateToken)}&scope=read:user`;
    res.redirect(authUrl);
  });

  app.get('/oauth/callback', async (req, res) => {
    try {
      const { code, state: stateToken } = req.query;
      const verified = jwt.verify(stateToken, stateSecret);
      if (!verified || verified.fed !== fedName) {
        throw new Error('Invalid state');
      }

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      const tokenJson = await tokenRes.json();
      if (!tokenJson.access_token) {
        throw new Error(tokenJson.error_description || 'Token exchange failed');
      }

      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          'User-Agent': 'fedmgr',
        },
      });
      const user = await userRes.json();

      const now = Math.floor(Date.now() / 1000);
      const federationToken = jwt.sign({
        iss: entityConfig.sub,
        sub: `github:${user.id}`,
        aud: ['mcp-demo', 'mcp-server'],
        iat: now,
        exp: now + 3600,
        auth_time: now,
        nonce: crypto.randomBytes(16).toString('hex'),
        preferred_username: user.login,
        name: user.name,
        email: user.email,
        picture: user.avatar_url,
        trust_chain: [entityConfig.sub],
        trust_marks: [{
          id: `${entityConfig.sub}/trust-marks/github-verified`,
          trust_mark: jwt.sign({
            iss: entityConfig.sub,
            sub: `github:${user.id}`,
            trust_mark_id: `${entityConfig.sub}/trust-marks/github-verified`,
            iat: now,
            exp: now + 86400,
          }, privateKey, { algorithm: 'RS256' })
        }],
        federation_entity: {
          authority_hints: [entityConfig.sub],
          trust_anchor_id: entityConfig.sub,
        },
        github: {
          id: user.id,
          login: user.login,
          type: user.type,
          verified: true,
        },
      }, privateKey, { algorithm: 'RS256', keyid: entityConfig.jwks.keys[0].kid });

      updateRegistry({
        users: {
          [user.id]: {
            github_id: user.id,
            login: user.login,
            federation_token: federationToken,
            trust_chain: [entityConfig.sub],
            created_at: new Date().toISOString(),
          },
        },
      });

      console.log(`✅ Issued OIDCFed token for GitHub user: ${user.login}`);
      const redirectUrl = `/?token=${encodeURIComponent(federationToken)}&user=${encodeURIComponent(user.login)}`;
      res.redirect(redirectUrl);
    } catch (err) {
      console.error('OAuth callback error:', err);
      res.status(500).send(`Authentication failed: ${err.message}`);
    }
  });
}

module.exports = registerOAuthRoutes;
