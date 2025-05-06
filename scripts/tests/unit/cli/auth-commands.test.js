const path = require('path');
const fs = require('fs');
const os = require('os');
const { 
  getStoredTokens, 
  saveToken, 
  getToken, 
  deleteToken,
  localOidcLogin,
  githubOAuthLogin
} = require('../../../../src/cli/auth-commands');

// Mock fetch for testing
jest.mock('node-fetch', () => jest.fn());
const fetch = require('node-fetch');

// Mock open for testing
jest.mock('open', () => jest.fn());
const open = require('open');

// Mock fs for testing
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn()
}));

// Mock http for testing
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
      
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenNthCalledWith(1, 'http://localhost:3000/.well-known/openid-configuration');
      expect(fetch).toHaveBeenNthCalledWith(2, 'http://localhost:3000/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: expect.stringContaining('grant_type=password')
      });
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
      
      // Mock token error response
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        json: () => Promise.resolve({
          error: 'invalid_grant',
          error_description: 'Invalid username or password'
        })
      }));
      
      await expect(localOidcLogin({
        username: 'test',
        password: 'wrong'
      })).rejects.toThrow('Authentication failed: Invalid username or password');
    });
  });
  
  describe('GitHub OAuth Login', () => {
    test('githubOAuthLogin opens browser and handles callback', async () => {
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
