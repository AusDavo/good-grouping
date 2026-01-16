/**
 * Integration tests for auth routes - /register and /login endpoints
 *
 * These tests verify the Express route handlers for passkey authentication.
 * They test the full request/response cycle including session management.
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');

// Mock the auth module
jest.mock('../auth', () => ({
  generateRegistrationOptionsForUser: jest.fn(),
  verifyAndStoreRegistration: jest.fn(),
  generateAuthenticationOptionsForUser: jest.fn(),
  verifyAuthentication: jest.fn(),
}));

// Mock the database module
jest.mock('../db', () => ({
  users: {
    findByName: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  invitations: {
    findByToken: jest.fn(),
    isValid: jest.fn(),
    markUsed: jest.fn(),
  },
}));

// Mock the middleware
jest.mock('../middleware/auth', () => ({
  redirectIfAuthenticated: (req, res, next) => next(),
}));

const {
  generateRegistrationOptionsForUser,
  verifyAndStoreRegistration,
  generateAuthenticationOptionsForUser,
  verifyAuthentication,
} = require('../auth');
const { users, invitations } = require('../db');

// Import router after mocks are set up
const authRouter = require('./auth');

// Helper to create Express app with router
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    })
  );
  // Mock render to just return JSON for testing
  app.use((req, res, next) => {
    res.render = (view, data) => res.json({ view, ...data });
    next();
  });
  app.use('/', authRouter);
  return app;
}

describe('Auth Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('POST /login/options', () => {
    it('should return 400 if username is not provided', async () => {
      const response = await request(app)
        .post('/login/options')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Name is required');
    });

    it('should return 400 if user is not found', async () => {
      generateAuthenticationOptionsForUser.mockResolvedValue({
        error: 'User not found',
      });

      const response = await request(app)
        .post('/login/options')
        .send({ username: 'nonexistent' })
        .expect(400);

      expect(response.body.error).toBe('User not found');
    });

    it('should return 400 if user has no passkeys', async () => {
      generateAuthenticationOptionsForUser.mockResolvedValue({
        error: 'No passkeys registered for this user',
      });

      const response = await request(app)
        .post('/login/options')
        .send({ username: 'userWithNoPasskeys' })
        .expect(400);

      expect(response.body.error).toBe('No passkeys registered for this user');
    });

    it('should return authentication options on success', async () => {
      const mockOptions = {
        challenge: 'test-challenge-base64url',
        timeout: 60000,
        rpId: 'localhost',
        allowCredentials: [
          { id: 'Y3JlZGVudGlhbC0x', transports: ['internal'] },
        ],
        userVerification: 'preferred',
      };
      const mockUser = { id: 'user-123', name: 'TestUser' };

      generateAuthenticationOptionsForUser.mockResolvedValue({
        options: mockOptions,
        user: mockUser,
      });

      const response = await request(app)
        .post('/login/options')
        .send({ username: 'TestUser' })
        .expect(200);

      expect(response.body).toEqual(mockOptions);
      expect(generateAuthenticationOptionsForUser).toHaveBeenCalledWith('TestUser');
    });

    it('should handle server errors gracefully', async () => {
      generateAuthenticationOptionsForUser.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/login/options')
        .send({ username: 'TestUser' })
        .expect(500);

      expect(response.body.error).toBe('Failed to generate authentication options');
    });
  });

  describe('POST /login/verify', () => {
    it('should return 400 if no authentication is in progress', async () => {
      const response = await request(app)
        .post('/login/verify')
        .send({ response: {} })
        .expect(400);

      expect(response.body.error).toBe('No authentication in progress');
    });

    it('should verify authentication and return success', async () => {
      const mockUser = { id: 'user-123', name: 'TestUser' };
      const mockOptions = {
        challenge: 'test-challenge',
        allowCredentials: [],
      };

      // First, set up the session by requesting options
      generateAuthenticationOptionsForUser.mockResolvedValue({
        options: mockOptions,
        user: mockUser,
      });

      const agent = request.agent(app);

      await agent.post('/login/options').send({ username: 'TestUser' }).expect(200);

      // Now verify
      users.findById.mockReturnValue(mockUser);
      verifyAuthentication.mockResolvedValue({
        verified: true,
        user: mockUser,
      });

      const authResponse = {
        id: 'Y3JlZGVudGlhbC0x',
        rawId: 'Y3JlZGVudGlhbC0x',
        response: {
          clientDataJSON: 'mock-client-data',
          authenticatorData: 'mock-auth-data',
          signature: 'mock-signature',
        },
        type: 'public-key',
      };

      const verifyResponse = await agent
        .post('/login/verify')
        .send({ response: authResponse })
        .expect(200);

      expect(verifyResponse.body.success).toBe(true);
      expect(verifyResponse.body.redirect).toBe('/');
    });

    it('should return 400 if user not found during verification', async () => {
      const mockOptions = { challenge: 'test-challenge', allowCredentials: [] };
      const mockUser = { id: 'user-123', name: 'TestUser' };

      generateAuthenticationOptionsForUser.mockResolvedValue({
        options: mockOptions,
        user: mockUser,
      });

      const agent = request.agent(app);
      await agent.post('/login/options').send({ username: 'TestUser' }).expect(200);

      users.findById.mockReturnValue(null);

      const response = await agent
        .post('/login/verify')
        .send({ response: {} })
        .expect(400);

      expect(response.body.error).toBe('User not found');
    });

    it('should return 400 if authentication verification fails', async () => {
      const mockOptions = { challenge: 'test-challenge', allowCredentials: [] };
      const mockUser = { id: 'user-123', name: 'TestUser' };

      generateAuthenticationOptionsForUser.mockResolvedValue({
        options: mockOptions,
        user: mockUser,
      });

      const agent = request.agent(app);
      await agent.post('/login/options').send({ username: 'TestUser' }).expect(200);

      users.findById.mockReturnValue(mockUser);
      verifyAuthentication.mockResolvedValue({ verified: false });

      const response = await agent
        .post('/login/verify')
        .send({ response: {} })
        .expect(400);

      expect(response.body.error).toBe('Authentication failed');
    });
  });

  describe('POST /register/options', () => {
    it('should return 400 if token or username is missing', async () => {
      const response = await request(app)
        .post('/register/options')
        .send({ token: 'test-token' })
        .expect(400);

      expect(response.body.error).toBe('Name is required');
    });

    it('should return 400 if username is too short', async () => {
      const response = await request(app)
        .post('/register/options')
        .send({ token: 'test-token', username: 'a' })
        .expect(400);

      expect(response.body.error).toBe('Name must be 2-50 characters');
    });

    it('should return 400 if username is too long', async () => {
      const longName = 'a'.repeat(51);
      const response = await request(app)
        .post('/register/options')
        .send({ token: 'test-token', username: longName })
        .expect(400);

      expect(response.body.error).toBe('Name must be 2-50 characters');
    });

    it('should return 400 if username already exists', async () => {
      users.findByName.mockReturnValue({ id: 'existing-user' });

      const response = await request(app)
        .post('/register/options')
        .send({ token: 'test-token', username: 'ExistingUser' })
        .expect(400);

      expect(response.body.error).toBe('Name already taken');
    });

    it('should return 400 if invitation is invalid', async () => {
      users.findByName.mockReturnValue(null);
      invitations.findByToken.mockReturnValue(null);
      invitations.isValid.mockReturnValue(false);
      users.count.mockReturnValue(1);

      const response = await request(app)
        .post('/register/options')
        .send({ token: 'invalid-token', username: 'NewUser' })
        .expect(400);

      expect(response.body.error).toBe('Invalid or expired invitation');
    });

    it('should return registration options for valid request', async () => {
      const mockOptions = {
        challenge: 'reg-challenge-base64url',
        rp: { name: 'Dart Score Sharing', id: 'localhost' },
        user: { id: 'encoded-id', name: 'NewUser', displayName: 'NewUser' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        timeout: 60000,
        attestationType: 'none',
      };

      users.findByName.mockReturnValue(null);
      invitations.findByToken.mockReturnValue({ id: 'inv-1', token: 'valid-token' });
      invitations.isValid.mockReturnValue(true);
      generateRegistrationOptionsForUser.mockResolvedValue(mockOptions);

      const response = await request(app)
        .post('/register/options')
        .send({ token: 'valid-token', username: 'NewUser' })
        .expect(200);

      expect(response.body).toEqual(mockOptions);
      expect(generateRegistrationOptionsForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'NewUser',
        })
      );
    });

    it('should allow first user registration with SYSTEM token', async () => {
      const mockOptions = { challenge: 'reg-challenge' };

      users.findByName.mockReturnValue(null);
      invitations.findByToken.mockReturnValue({
        id: 'system-inv',
        token: 'system-token',
        created_by: 'SYSTEM',
      });
      invitations.isValid.mockReturnValue(false); // Expired but system token
      users.count.mockReturnValue(0); // No users yet

      generateRegistrationOptionsForUser.mockResolvedValue(mockOptions);

      const response = await request(app)
        .post('/register/options')
        .send({ token: 'system-token', username: 'FirstAdmin' })
        .expect(200);

      expect(response.body).toEqual(mockOptions);
    });
  });

  describe('POST /register/verify', () => {
    it('should return 400 if no registration is in progress', async () => {
      const response = await request(app)
        .post('/register/verify')
        .send({ response: {} })
        .expect(400);

      expect(response.body.error).toBe('No registration in progress');
    });

    it('should create user and store passkey on successful verification', async () => {
      const mockOptions = { challenge: 'reg-challenge' };
      const mockUser = { id: 'new-user-123', name: 'NewUser', is_admin: false };

      users.findByName.mockReturnValue(null);
      invitations.findByToken.mockReturnValue({ id: 'inv-1', token: 'valid-token' });
      invitations.isValid.mockReturnValue(true);
      generateRegistrationOptionsForUser.mockResolvedValue(mockOptions);

      const agent = request.agent(app);

      // First request options to set up session
      await agent
        .post('/register/options')
        .send({ token: 'valid-token', username: 'NewUser' })
        .expect(200);

      // Now verify
      users.create.mockReturnValue(mockUser);
      users.count.mockReturnValue(1);
      verifyAndStoreRegistration.mockResolvedValue({ verified: true });

      const regResponse = {
        id: 'bmV3LWNyZWRlbnRpYWw',
        rawId: 'bmV3LWNyZWRlbnRpYWw',
        response: {
          clientDataJSON: 'mock-client-data',
          attestationObject: 'mock-attestation',
          transports: ['internal'],
        },
        type: 'public-key',
      };

      const verifyResponse = await agent
        .post('/register/verify')
        .send({ response: regResponse })
        .expect(200);

      expect(verifyResponse.body.success).toBe(true);
      expect(verifyResponse.body.redirect).toBe('/');
      expect(users.create).toHaveBeenCalledWith('NewUser', false);
      expect(invitations.markUsed).toHaveBeenCalled();
    });

    it('should make first user an admin', async () => {
      const mockOptions = { challenge: 'reg-challenge' };

      users.findByName.mockReturnValue(null);
      invitations.findByToken.mockReturnValue({
        id: 'system-inv',
        token: 'system-token',
        created_by: 'SYSTEM',
      });
      invitations.isValid.mockReturnValue(false);
      users.count.mockReturnValue(0); // First call - no users

      generateRegistrationOptionsForUser.mockResolvedValue(mockOptions);

      const agent = request.agent(app);

      await agent
        .post('/register/options')
        .send({ token: 'system-token', username: 'FirstAdmin' })
        .expect(200);

      const mockUser = { id: 'admin-123', name: 'FirstAdmin', is_admin: true };
      users.create.mockReturnValue(mockUser);
      verifyAndStoreRegistration.mockResolvedValue({ verified: true });

      await agent.post('/register/verify').send({ response: {} }).expect(200);

      // First user should be created as admin (second argument is true)
      expect(users.create).toHaveBeenCalledWith('FirstAdmin', true);
    });

    it('should return 400 if passkey verification fails', async () => {
      const mockOptions = { challenge: 'reg-challenge' };

      users.findByName.mockReturnValue(null);
      invitations.findByToken.mockReturnValue({ id: 'inv-1' });
      invitations.isValid.mockReturnValue(true);
      generateRegistrationOptionsForUser.mockResolvedValue(mockOptions);

      const agent = request.agent(app);

      await agent
        .post('/register/options')
        .send({ token: 'valid-token', username: 'NewUser' })
        .expect(200);

      users.create.mockReturnValue({ id: 'user-123' });
      users.count.mockReturnValue(1);
      verifyAndStoreRegistration.mockResolvedValue({ verified: false });

      const response = await agent
        .post('/register/verify')
        .send({ response: {} })
        .expect(400);

      expect(response.body.error).toBe('Passkey registration failed');
    });

    it('should return 400 if invitation becomes invalid between options and verify', async () => {
      const mockOptions = { challenge: 'reg-challenge' };

      users.findByName.mockReturnValue(null);
      invitations.findByToken.mockReturnValue({ id: 'inv-1' });
      invitations.isValid
        .mockReturnValueOnce(true) // During /register/options
        .mockReturnValueOnce(false); // During /register/verify (expired)
      users.count.mockReturnValue(1);

      generateRegistrationOptionsForUser.mockResolvedValue(mockOptions);

      const agent = request.agent(app);

      await agent
        .post('/register/options')
        .send({ token: 'valid-token', username: 'NewUser' })
        .expect(200);

      const response = await agent
        .post('/register/verify')
        .send({ response: {} })
        .expect(400);

      expect(response.body.error).toBe('Invalid or expired invitation');
    });
  });

  describe('Logout Routes', () => {
    it('POST /logout should destroy session and redirect', async () => {
      const response = await request(app).post('/logout').expect(302);

      expect(response.headers.location).toBe('/login');
    });

    it('GET /logout should destroy session and redirect', async () => {
      const response = await request(app).get('/logout').expect(302);

      expect(response.headers.location).toBe('/login');
    });
  });

  describe('Edge Cases', () => {
    it('should handle whitespace in username', async () => {
      users.findByName.mockReturnValue(null);
      invitations.findByToken.mockReturnValue({ id: 'inv-1' });
      invitations.isValid.mockReturnValue(true);
      generateRegistrationOptionsForUser.mockResolvedValue({ challenge: 'test' });

      const response = await request(app)
        .post('/register/options')
        .send({ token: 'valid-token', username: '  John Doe  ' })
        .expect(200);

      expect(generateRegistrationOptionsForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'John Doe', // Trimmed
        })
      );
    });

    it('should allow names with special characters', async () => {
      users.findByName.mockReturnValue(null);
      invitations.findByToken.mockReturnValue({ id: 'inv-1' });
      invitations.isValid.mockReturnValue(true);
      generateRegistrationOptionsForUser.mockResolvedValue({ challenge: 'test' });

      await request(app)
        .post('/register/options')
        .send({ token: 'valid-token', username: "John O'Brien-Smith" })
        .expect(200);

      expect(generateRegistrationOptionsForUser).toHaveBeenCalled();
    });

    it('should handle empty username string', async () => {
      const response = await request(app)
        .post('/register/options')
        .send({ token: 'valid-token', username: '' })
        .expect(400);

      expect(response.body.error).toBe('Name is required');
    });

    it('should handle concurrent authentication attempts via session isolation', async () => {
      const mockOptions = { challenge: 'challenge-1' };
      const mockUser = { id: 'user-1', name: 'User1' };

      generateAuthenticationOptionsForUser.mockResolvedValue({
        options: mockOptions,
        user: mockUser,
      });

      // Create two separate agents (separate sessions)
      const agent1 = request.agent(app);
      const agent2 = request.agent(app);

      // Both start authentication
      await agent1.post('/login/options').send({ username: 'User1' }).expect(200);
      await agent2.post('/login/options').send({ username: 'User1' }).expect(200);

      // Verify that sessions are independent
      users.findById.mockReturnValue(mockUser);
      verifyAuthentication.mockResolvedValue({ verified: true, user: mockUser });

      // Both should be able to verify independently
      await agent1.post('/login/verify').send({ response: {} }).expect(200);
      await agent2.post('/login/verify').send({ response: {} }).expect(200);
    });
  });
});
