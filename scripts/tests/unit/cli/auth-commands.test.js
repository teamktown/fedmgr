// jest.mock calls MUST come before require statements to ensure mocks are applied
// when the auth-commands module loads (babel-plugin-jest-hoist hoists these to top)
jest.mock('node-fetch', () => jest.fn());
jest.mock('open', () => jest.fn());
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn()
}));
jest.mock('http', () => ({
  createServer: jest.fn(() => ({
    listen: jest.fn((port, callback) => {
      callback();
      return {
        close: jest.fn(callback => callback())
      };
    }),
    on: jest.fn((event, callback) => {})
  }))
}));

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const fetch = require('node-fetch');
const open = require('open');
const {
  getStoredTokens,
  saveToken,
  getToken,
  deleteToken,
  localOidcLogin,
  githubOAuthLogin
} = require('../../../../src/fedmgr/auth-commands');

describe('Auth Commands', () => {
  const mockTokenStorePath = path.join(os.homedir(), '.fedmgr-tokens.json');
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('Token Storage', () => {
    test('getStoredTokens returns empty object when file does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      
      const tokens = getStoredTokens();
      
      expect(tokens).toEqual({});
      expect(fs.existsSync).toHaveBeenCalledWith(mockTokenStorePath);
    });
    
    test('getStoredTokens returns tokens from file', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        'local-oidc-op': { access_token: 'test-token' }
      }));
      
      const tokens = getStoredTokens();
      
      expect(tokens).toEqual({
        'local-oidc-op': { access_token: 'test-token' }
      });
      expect(fs.existsSync).toHaveBeenCalledWith(mockTokenStorePath);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockTokenStorePath, 'utf-8');
    });
    
    test('saveToken writes token to file', () => {
      const mockTokens = { 'github': { access_token: 'existing-token' } };
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockTokens));
      
      saveToken('local-oidc-op', { access_token: 'new-token' });
      
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockTokenStorePath,
        JSON.stringify({
          'github': { access_token: 'existing-token' },
          'local-oidc-op': { access_token: 'new-token' }
        }, null, 2)
      );
    });
    
    test('getToken returns token for provider', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        'local-oidc-op': { access_token: 'test-token' }
      }));
      
      const token = getToken('local-oidc-op');
      
      expect(token).toEqual({ access_token: 'test-token' });
    });
    
    test('deleteToken removes token for provider', () => {
      const mockTokens = {
        'github': { access_token: 'github-token' },
        'local-oidc-op': { access_token: 'oidc-token' }
      };
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockTokens));
      
      deleteToken('github');
      
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockTokenStorePath,
        JSON.stringify({
          'local-oidc-op': { access_token: 'oidc-token' }
        }, null, 2)
      );
    });
  });
  
  describe('Local OIDC Login', () => {
    test('localOidcLogin fetches token from OIDC provider', async () => {
      // Mock discovery response
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          token_endpoint: 'http://localhost:3000/token'
        })
      }));
      
      // Mock token response
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'test-access-token',
          id_token: 'test-id-token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      }));
      
      const token = await localOidcLogin({
        username: 'test',
        password: 'test',
        opUrl: 'http://localhost:3000',
        clientId: 'fedmgr-cli',
        clientSecret: 'top-secret',
        federation: 'fed-alpha'
      });

      expect(token).toEqual({
        access_token: 'test-access-token',
        id_token: 'test-id-token',
        token_type: 'Bearer',
        expires_in: 3600,
        federation: 'fed-alpha',
        provider: 'local-oidc-op',
        timestamp: expect.any(Number)
      });

      // #3: a confidential client MUST authenticate to the token endpoint via
      // HTTP Basic. Dropping this header yields 401 invalid_client.
      const expectedAuth = 'Basic ' + Buffer.from('fedmgr-cli:top-secret').toString('base64');
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenNthCalledWith(1, 'http://localhost:3000/.well-known/openid-configuration');
      expect(fetch).toHaveBeenNthCalledWith(2, 'http://localhost:3000/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Authorization': expectedAuth
        },
        body: expect.stringContaining('grant_type=password')
      });
    });

    test('localOidcLogin omits client auth for a public client (no secret)', async () => {
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ token_endpoint: 'http://localhost:3000/token' })
      }));
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: 'a', token_type: 'Bearer' })
      }));

      await localOidcLogin({
        username: 'test',
        password: 'test',
        opUrl: 'http://localhost:3000',
        clientId: 'public-client',
        clientSecret: ''
      });

      // #3: public clients have no secret and must NOT send an Authorization header.
      const tokenCallHeaders = fetch.mock.calls[1][1].headers;
      expect(tokenCallHeaders).not.toHaveProperty('Authorization');
    });
    
    test('localOidcLogin handles discovery error', async () => {
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        statusText: 'Not Found'
      }));
      
      await expect(localOidcLogin({
        username: 'test',
        password: 'test'
      })).rejects.toThrow('Failed to discover OIDC configuration: Not Found');
    });
    
    test('localOidcLogin handles token error', async () => {
      // Mock discovery response
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          token_endpoint: 'http://localhost:3000/token'
        })
      }));
      
      // Mock token error response — body delivered as text (real responses
      // expose .text(); the error path must not assume JSON, see #9).
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve(JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid username or password'
        }))
      }));

      await expect(localOidcLogin({
        username: 'test',
        password: 'wrong'
      })).rejects.toThrow('Authentication failed: Invalid username or password');
    });

    test('localOidcLogin surfaces a non-JSON error body instead of masking it', async () => {
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ token_endpoint: 'http://localhost:3000/token' })
      }));
      // #9: a plain-text error body (e.g. a 502 from a proxy). Parsing it as JSON
      // would throw and hide the real failure; the message must carry the status
      // and the body text.
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: () => Promise.resolve('upstream is down')
      }));

      await expect(localOidcLogin({
        username: 'test',
        password: 'test',
        opUrl: 'http://localhost:3000'
      })).rejects.toThrow(/502.*upstream is down/);
    });
  });
  
  describe('GitHub OAuth Login', () => {
    test.skip('githubOAuthLogin opens browser and handles callback', async () => {
      // This test is more complex due to the OAuth flow
      // We'll mock the server and callback handling
      
      // Mock the http server to simulate a callback
      const http = require('http');
      const mockServer = {
        listen: jest.fn((port, callback) => {
          // Simulate server start
          callback();
          
          // Simulate callback request
          setTimeout(() => {
            const mockReq = {
              url: '/callback?code=test-code&state=test-state',
              headers: { host: 'localhost:3456' }
            };
            
            const mockRes = {
              writeHead: jest.fn(),
              end: jest.fn()
            };
            
            // Call the request handler
            http.createServer.mock.calls[0][0](mockReq, mockRes);
          }, 10);
          
          return {
            close: jest.fn(callback => callback())
          };
        }),
        on: jest.fn()
      };
      
      http.createServer.mockReturnValue(mockServer);
      
      // Mock token exchange response
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'github-access-token',
          token_type: 'Bearer',
          scope: 'read:user'
        })
      }));
      
      // Mock crypto for state generation
      jest.spyOn(crypto, 'randomBytes').mockReturnValue({
        toString: () => 'test-state'
      });
      
      const tokenPromise = githubOAuthLogin({
        clientId: 'test-client-id',
        federation: 'fed-alpha'
      });
      
      // Open should be called with the GitHub OAuth URL
      expect(open).toHaveBeenCalledWith(expect.stringContaining('https://github.com/login/oauth/authorize'));
      
      const token = await tokenPromise;
      
      expect(token).toEqual({
        access_token: 'github-access-token',
        token_type: 'Bearer',
        scope: 'read:user',
        federation: 'fed-alpha',
        provider: 'github',
        timestamp: expect.any(Number)
      });
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:3001/token-exchange', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: 'test-code',
          client_id: 'test-client-id',
          redirect_uri: 'http://localhost:3456/callback',
          provider: 'github'
        })
      });
    });
  });
});
