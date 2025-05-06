/**
 * Authentication Commands for the fedmgr CLI
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const fetch = require('node-fetch');
const open = require('open');

// Store tokens in user's home directory
const TOKEN_STORE_PATH = path.join(os.homedir(), '.fedmgr-tokens.json');

/**
 * Get stored tokens
 * @returns {Object} Stored tokens
 */
function getStoredTokens() {
  if (!fs.existsSync(TOKEN_STORE_PATH)) {
    return {};
  }
  
  try {
    return JSON.parse(fs.readFileSync(TOKEN_STORE_PATH, 'utf-8'));
  } catch (error) {
    console.error('Error reading token store:', error);
    return {};
  }
}

/**
 * Save token to store
 * @param {string} provider - Token provider (e.g., 'github', 'local-oidc-op')
 * @param {Object} token - Token data
 */
function saveToken(provider, token) {
  const tokens = getStoredTokens();
  tokens[provider] = token;
  fs.writeFileSync(TOKEN_STORE_PATH, JSON.stringify(tokens, null, 2));
}

/**
 * Get a stored token
 * @param {string} provider - Token provider (e.g., 'github', 'local-oidc-op')
 * @returns {Object} Token data
 */
function getToken(provider) {
  const tokens = getStoredTokens();
  return tokens[provider];
}

/**
 * Delete a stored token
 * @param {string} provider - Token provider (e.g., 'github', 'local-oidc-op')
 */
function deleteToken(provider) {
  const tokens = getStoredTokens();
  delete tokens[provider];
  fs.writeFileSync(TOKEN_STORE_PATH, JSON.stringify(tokens, null, 2));
}

/**
 * Authenticate with local OIDC OP using Resource Owner Password Credentials grant
 * @param {Object} options - Authentication options
 * @returns {Promise<Object>} Token response
 */
async function localOidcLogin(options) {
  const { username, password, opUrl = 'http://localhost:3000', federation = 'fed-alpha' } = options;
  
  // First, discover endpoints from the OIDC provider
  const discoveryUrl = `${opUrl}/.well-known/openid-configuration`;
  console.log(`Discovering OIDC configuration from ${discoveryUrl}...`);
  
  try {
    const discoveryResponse = await fetch(discoveryUrl);
    if (!discoveryResponse.ok) {
      throw new Error(`Failed to discover OIDC configuration: ${discoveryResponse.statusText}`);
    }
    
    const config = await discoveryResponse.json();
    const tokenEndpoint = config.token_endpoint;
    
    if (!tokenEndpoint) {
      throw new Error('Token endpoint not found in OIDC configuration');
    }
    
    console.log(`Authenticating with username and password...`);
    
    // Request token using password grant
    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username,
        password,
        client_id: 'fedmgr-cli', // Default client ID (should be registered with the OP)
        scope: 'openid profile'
      }).toString()
    });
    
    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      throw new Error(`Authentication failed: ${error.error_description || error.error || tokenResponse.statusText}`);
    }
    
    const token = await tokenResponse.json();
    
    // Add federation information to the token
    token.federation = federation;
    token.provider = 'local-oidc-op';
    token.timestamp = Date.now();
    
    return token;
  } catch (error) {
    console.error(`Authentication failed: ${error.message}`);
    throw error;
  }
}

/**
 * Authenticate with GitHub OAuth
 * @param {Object} options - Authentication options
 * @returns {Promise<Object>} Token response
 */
async function githubOAuthLogin(options) {
  const { clientId = 'fedmgr-github-client', federation = 'fed-alpha' } = options;
  const redirectUri = 'http://localhost:3456/callback';
  const state = crypto.randomBytes(16).toString('hex');
  const scope = 'read:user';
  
  // Create the GitHub OAuth URL
  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.append('client_id', clientId);
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('state', state);
  authUrl.searchParams.append('scope', scope);
  
  console.log(`Opening browser for GitHub authentication...`);
  
  // Create a local server to handle the callback
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://${req.headers.host}`);
        
        if (reqUrl.pathname === '/callback') {
          const code = reqUrl.searchParams.get('code');
          const returnedState = reqUrl.searchParams.get('state');
          
          if (returnedState !== state) {
            throw new Error('OAuth state mismatch');
          }
          
          if (!code) {
            throw new Error('No code returned from GitHub');
          }
          
          // Exchange code for token
          console.log(`Exchanging code for token...`);
          
          // In a real implementation, this would be done through a secure backend
          // For this demo, we'll use a token exchange service
          const tokenExchangeUrl = 'http://localhost:3001/token-exchange';
          const tokenResponse = await fetch(tokenExchangeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              code,
              client_id: clientId,
              redirect_uri: redirectUri,
              provider: 'github'
            })
          });
          
          if (!tokenResponse.ok) {
            throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
          }
          
          const token = await tokenResponse.json();
          
          // Add federation information to the token
          token.federation = federation;
          token.provider = 'github';
          token.timestamp = Date.now();
          
          // Send success response to browser
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Authentication Successful</h1>
                <p>You can now close this window and return to the CLI.</p>
                <script>window.close();</script>
              </body>
            </html>
          `);
          
          // Close the server and resolve the promise
          server.close();
          resolve(token);
        } else {
          // Handle other routes
          res.writeHead(404);
          res.end('Not found');
        }
      } catch (error) {
        console.error(`Authentication failed: ${error.message}`);
        
        // Send error response to browser
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h1>Authentication Failed</h1>
              <p>Error: ${error.message}</p>
              <p>Please close this window and try again.</p>
            </body>
          </html>
        `);
        
        // Close the server and reject the promise
        server.close();
        reject(error);
      }
    });
    
    // Start the server
    server.listen(3456, () => {
      console.log(`Callback server listening on http://localhost:3456`);
      
      // Open the browser
      open(authUrl.toString()).catch(error => {
        console.error(`Failed to open browser: ${error.message}`);
        console.log(`Please open this URL manually: ${authUrl.toString()}`);
      });
    });
    
    // Handle server errors
    server.on('error', error => {
      console.error(`Server error: ${error.message}`);
      reject(error);
    });
  });
}

/**
 * Register authentication commands with the CLI
 * @param {Object} program - Commander program instance
 */
function registerAuthCommands(program) {
  program
    .command('login')
    .description('Authenticate with a provider')
    .argument('<provider>', 'Authentication provider (local-oidc-op or github)')
    .option('--username <username>', 'Username for local-oidc-op')
    .option('--password <password>', 'Password for local-oidc-op')
    .option('--federation <name>', 'Federation to use', 'fed-alpha')
    .option('--op-url <url>', 'OIDC Provider URL for local-oidc-op', 'http://localhost:3000')
    .option('--client-id <id>', 'Client ID for GitHub OAuth', 'fedmgr-github-client')
    .action(async (provider, options) => {
      try {
        let token;
        
        if (provider === 'local-oidc-op') {
          // If username/password not provided via options, prompt for them
          if (!options.username || !options.password) {
            console.log('Please provide username and password via --username and --password options');
            process.exit(1);
          }
          
          console.log('🔐 Authenticating with local OIDC provider...');
          
          token = await localOidcLogin({
            username: options.username,
            password: options.password,
            opUrl: options.opUrl,
            federation: options.federation
          });
        } 
        else if (provider === 'github') {
          console.log('🔐 Authenticating with GitHub...');
          
          token = await githubOAuthLogin({
            clientId: options.clientId,
            federation: options.federation
          });
        } 
        else {
          console.error(`❌ Unsupported provider: ${provider}`);
          console.log('Supported providers: local-oidc-op, github');
          process.exit(1);
        }
        
        // Save token
        saveToken(provider, token);
        
        console.log(`✅ Successfully authenticated!`);
        console.log(`📝 Federation token saved. Federation: ${token.federation}`);
        
        if (token.expires_in) {
          console.log(`Token expires in ${Math.floor(token.expires_in / 60)} minutes`);
        }
        
        // Display token usage instructions
        console.log('\nTo use this token with MCP calls:');
        console.log(`  fedmgr call mcp-1`);
        console.log('  (The token will be used automatically)');
      } catch (error) {
        console.error(`❌ Authentication failed: ${error.message}`);
        process.exit(1);
      }
    });
  
  program
    .command('logout')
    .description('Log out and remove stored tokens')
    .argument('[provider]', 'Provider to log out from (omit to log out from all)')
    .action((provider) => {
      if (provider) {
        deleteToken(provider);
        console.log(`✅ Logged out from ${provider}`);
      } else {
        // Clear all tokens
        const tokens = getStoredTokens();
        Object.keys(tokens).forEach(p => deleteToken(p));
        console.log('✅ Logged out from all providers');
      }
    });
  
  program
    .command('token')
    .description('Display or manage stored tokens')
    .argument('[provider]', 'Provider to show token for (omit to show all)')
    .option('--show-value', 'Show the actual token value (sensitive)')
    .action((provider, options) => {
      const tokens = getStoredTokens();
      
      if (provider) {
        const token = tokens[provider];
        if (!token) {
          console.log(`No token found for provider: ${provider}`);
          return;
        }
        
        console.log(`Provider: ${provider}`);
        console.log(`Federation: ${token.federation || 'unknown'}`);
        
        if (token.timestamp) {
          const date = new Date(token.timestamp);
          console.log(`Obtained: ${date.toLocaleString()}`);
        }
        
        if (token.expires_in && token.timestamp) {
          const expiresAt = new Date(token.timestamp + token.expires_in * 1000);
          console.log(`Expires: ${expiresAt.toLocaleString()}`);
        }
        
        if (options.showValue) {
          console.log('\nToken Value:');
          console.log(token.access_token || token.id_token || 'No token value found');
        }
      } else {
        const providers = Object.keys(tokens);
        
        if (providers.length === 0) {
          console.log('No tokens found');
          return;
        }
        
        console.log('Stored tokens:');
        providers.forEach(p => {
          const token = tokens[p];
          console.log(`- ${p} (Federation: ${token.federation || 'unknown'})`);
        });
      }
    });
}

module.exports = {
  registerAuthCommands,
  getStoredTokens,
  getToken,
  saveToken,
  deleteToken,
  localOidcLogin,
  githubOAuthLogin
};
