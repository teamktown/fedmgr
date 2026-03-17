// jest.mock calls MUST come before require statements to ensure mocks are applied
// when the service module loads (babel-plugin-jest-hoist hoists these to top of file)
jest.mock('node-fetch', () => jest.fn());
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock-jwt-token')
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(() => 'mock-private-key')
}));

const TokenExchangeService = require('../../../../src/fedmgr/server/token-exchange-service');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const request = require('supertest');

describe('Token Exchange Service', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TokenExchangeService({
      port: 3457,
      federationAdminUrl: 'http://localhost:3001',
      githubClientId: 'test-client-id',
      githubClientSecret: 'test-client-secret'
    });
  });

  describe('GitHub Code Exchange', () => {
    test('exchangeGitHubCode exchanges code for token', async () => {
      // Mock GitHub token response
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'github-access-token',
          token_type: 'bearer',
          scope: 'read:user'
        })
      }));

      const token = await service.exchangeGitHubCode(
        'test-code',
        'test-client-id',
        'http://localhost:3456/callback'
      );

      expect(token).toEqual({
        access_token: 'github-access-token',
        token_type: 'bearer',
        scope: 'read:user'
      });

      expect(fetch).toHaveBeenCalledWith('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          code: 'test-code',
          redirect_uri: 'http://localhost:3456/callback'
        })
      });
    });

    test('exchangeGitHubCode handles error response', async () => {
      // Mock GitHub error response
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          error: 'bad_verification_code',
          error_description: 'The code passed is incorrect or expired.'
        })
      }));

      await expect(service.exchangeGitHubCode(
        'invalid-code',
        'test-client-id',
        'http://localhost:3456/callback'
      )).rejects.toThrow('GitHub token exchange failed: The code passed is incorrect or expired.');
    });

    test('exchangeGitHubCode handles network error', async () => {
      // Mock network error
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        statusText: 'Service Unavailable'
      }));

      await expect(service.exchangeGitHubCode(
        'test-code',
        'test-client-id',
        'http://localhost:3456/callback'
      )).rejects.toThrow('GitHub token exchange failed: Service Unavailable');
    });
  });

  describe('Federation Token Conversion', () => {
    test('convertToFederationToken creates federation token', async () => {
      const githubToken = {
        access_token: 'github-access-token',
        token_type: 'bearer',
        scope: 'read:user'
      };

      const federationToken = await service.convertToFederationToken(githubToken, 'github');

      expect(federationToken).toEqual({
        access_token: 'github-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: 'mock-jwt-token',
        scope: 'openid profile'
      });

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          iss: 'http://localhost:3001',
          sub: 'github-user-123',
          aud: 'fedmgr-cli',
          provider: 'github',
          federation: {
            trust_chain: ['fed-alpha']
          }
        }),
        'mock-private-key',
        { algorithm: 'RS256' }
      );
    });
  });

  describe('Token Exchange Endpoint', () => {
    test('token-exchange endpoint handles GitHub code exchange', async () => {
      // Spy on service methods to avoid real network calls
      jest.spyOn(service, 'exchangeGitHubCode').mockResolvedValue({
        access_token: 'github-access-token',
        token_type: 'bearer',
        scope: 'read:user'
      });

      jest.spyOn(service, 'convertToFederationToken').mockResolvedValue({
        access_token: 'github-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: 'mock-jwt-token',
        scope: 'openid profile'
      });

      const res = await request(service.app)
        .post('/token-exchange')
        .send({
          code: 'test-code',
          client_id: 'test-client-id',
          redirect_uri: 'http://localhost:3456/callback',
          provider: 'github'
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        access_token: 'github-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: 'mock-jwt-token',
        scope: 'openid profile'
      });

      expect(service.exchangeGitHubCode).toHaveBeenCalledWith(
        'test-code',
        'test-client-id',
        'http://localhost:3456/callback'
      );
    });

    test('token-exchange endpoint handles missing parameters', async () => {
      const res = await request(service.app)
        .post('/token-exchange')
        .send({
          client_id: 'test-client-id',
          redirect_uri: 'http://localhost:3456/callback'
          // Missing code and provider
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Missing required parameters'
      });
    });

    test('token-exchange endpoint handles unsupported provider', async () => {
      const res = await request(service.app)
        .post('/token-exchange')
        .send({
          code: 'test-code',
          client_id: 'test-client-id',
          redirect_uri: 'http://localhost:3456/callback',
          provider: 'unsupported'
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Unsupported provider: unsupported'
      });
    });
  });

  describe('Service Lifecycle', () => {
    test('start method starts the server', async () => {
      // Mock the listen method
      service.app.listen = jest.fn((port, callback) => {
        callback();
        return { close: jest.fn() };
      });

      await service.start();

      expect(service.app.listen).toHaveBeenCalledWith(3457, expect.any(Function));
    });

    test('stop method stops the server', async () => {
      // Mock the server
      service.server = {
        close: jest.fn(callback => callback())
      };

      await service.stop();

      expect(service.server.close).toHaveBeenCalled();
    });

    test('stop method handles no server', async () => {
      service.server = null;

      await expect(service.stop()).resolves.toBeUndefined();
    });
  });
});
