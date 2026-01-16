/**
 * Unit tests for auth.js - Passkey authentication functions
 *
 * These tests verify the WebAuthn/passkey authentication flow using @simplewebauthn/server v10.
 * Critical test: Credential IDs must be passed as base64url strings (not Buffers) to match v10 API.
 */

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

// Mock the simplewebauthn/server module
jest.mock('@simplewebauthn/server');

// Mock the database module
jest.mock('./db', () => ({
  users: {
    findByName: jest.fn(),
    findById: jest.fn(),
  },
  passkeys: {
    findByUserId: jest.fn(),
    findByCredentialId: jest.fn(),
    create: jest.fn(),
    updateCounter: jest.fn(),
  },
}));

const { users, passkeys } = require('./db');
const {
  generateRegistrationOptionsForUser,
  verifyAndStoreRegistration,
  generateAuthenticationOptionsForUser,
  verifyAuthentication,
} = require('./auth');

describe('auth.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateRegistrationOptionsForUser', () => {
    const mockUser = { id: 'user-123', name: 'TestUser' };

    it('should generate registration options for a new user with no existing passkeys', async () => {
      passkeys.findByUserId.mockReturnValue([]);
      generateRegistrationOptions.mockResolvedValue({
        challenge: 'mock-challenge',
        rp: { name: 'Good Grouping', id: 'localhost' },
        user: { id: 'encoded-id', name: 'TestUser', displayName: 'TestUser' },
      });

      const options = await generateRegistrationOptionsForUser(mockUser);

      expect(passkeys.findByUserId).toHaveBeenCalledWith('user-123');
      expect(generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: 'TestUser',
          userDisplayName: 'TestUser',
          excludeCredentials: [],
        })
      );
      expect(options).toHaveProperty('challenge');
    });

    it('should exclude existing passkeys from registration options', async () => {
      const existingPasskeys = [
        { credential_id: 'Y3JlZGVudGlhbC0x', transports: ['usb', 'nfc'] },
        { credential_id: 'Y3JlZGVudGlhbC0y', transports: ['internal'] },
      ];
      passkeys.findByUserId.mockReturnValue(existingPasskeys);
      generateRegistrationOptions.mockResolvedValue({ challenge: 'mock-challenge' });

      await generateRegistrationOptionsForUser(mockUser);

      expect(generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: [
            { id: 'Y3JlZGVudGlhbC0x', transports: ['usb', 'nfc'] },
            { id: 'Y3JlZGVudGlhbC0y', transports: ['internal'] },
          ],
        })
      );
    });

    it('should pass credential IDs as base64url strings, NOT as Buffers (simplewebauthn v10 requirement)', async () => {
      // This test specifically catches the bug where credential_id was passed as a Buffer
      // In simplewebauthn v10, excludeCredentials[].id must be a base64url string
      const base64urlCredentialId = 'dGVzdC1jcmVkZW50aWFsLWlk'; // base64url encoded
      const existingPasskeys = [
        { credential_id: base64urlCredentialId, transports: ['internal'] },
      ];
      passkeys.findByUserId.mockReturnValue(existingPasskeys);
      generateRegistrationOptions.mockResolvedValue({ challenge: 'mock-challenge' });

      await generateRegistrationOptionsForUser(mockUser);

      const callArgs = generateRegistrationOptions.mock.calls[0][0];

      // Verify the credential ID is passed as a string, not a Buffer
      expect(typeof callArgs.excludeCredentials[0].id).toBe('string');
      expect(callArgs.excludeCredentials[0].id).toBe(base64urlCredentialId);
      expect(Buffer.isBuffer(callArgs.excludeCredentials[0].id)).toBe(false);
    });

    it('should handle undefined transports gracefully', async () => {
      const existingPasskeys = [
        { credential_id: 'Y3JlZGVudGlhbC0x', transports: null },
        { credential_id: 'Y3JlZGVudGlhbC0y' }, // no transports field
      ];
      passkeys.findByUserId.mockReturnValue(existingPasskeys);
      generateRegistrationOptions.mockResolvedValue({ challenge: 'mock-challenge' });

      await generateRegistrationOptionsForUser(mockUser);

      expect(generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: [
            { id: 'Y3JlZGVudGlhbC0x', transports: undefined },
            { id: 'Y3JlZGVudGlhbC0y', transports: undefined },
          ],
        })
      );
    });
  });

  describe('verifyAndStoreRegistration', () => {
    const mockUser = { id: 'user-123', name: 'TestUser' };
    const mockResponse = {
      id: 'bmV3LWNyZWRlbnRpYWwtaWQ',
      rawId: 'bmV3LWNyZWRlbnRpYWwtaWQ',
      response: {
        clientDataJSON: 'mock-client-data',
        attestationObject: 'mock-attestation',
        transports: ['internal', 'hybrid'],
      },
      type: 'public-key',
    };
    const mockChallenge = 'expected-challenge';

    it('should verify registration and store passkey on success', async () => {
      const mockCredentialId = new Uint8Array([1, 2, 3, 4, 5]);
      const mockPublicKey = new Uint8Array([10, 20, 30, 40, 50]);

      verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: mockCredentialId,
          credentialPublicKey: mockPublicKey,
          counter: 0,
        },
      });
      passkeys.create.mockReturnValue({ id: 'passkey-1' });

      const result = await verifyAndStoreRegistration(mockUser, mockResponse, mockChallenge);

      expect(result.verified).toBe(true);
      expect(passkeys.create).toHaveBeenCalledWith(
        'user-123',
        expect.any(String), // base64url encoded credential ID
        expect.any(String), // base64 encoded public key
        0,
        ['internal', 'hybrid']
      );
    });

    it('should store credential ID as base64url string', async () => {
      const mockCredentialId = new Uint8Array([1, 2, 3, 4, 5]);
      const mockPublicKey = new Uint8Array([10, 20, 30, 40, 50]);

      verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: mockCredentialId,
          credentialPublicKey: mockPublicKey,
          counter: 0,
        },
      });

      await verifyAndStoreRegistration(mockUser, mockResponse, mockChallenge);

      const createCall = passkeys.create.mock.calls[0];
      const storedCredentialId = createCall[1];

      // Verify it's stored as base64url
      expect(storedCredentialId).toBe(Buffer.from(mockCredentialId).toString('base64url'));
    });

    it('should return verified: false when verification fails', async () => {
      verifyRegistrationResponse.mockResolvedValue({
        verified: false,
        registrationInfo: null,
      });

      const result = await verifyAndStoreRegistration(mockUser, mockResponse, mockChallenge);

      expect(result.verified).toBe(false);
      expect(passkeys.create).not.toHaveBeenCalled();
    });

    it('should pass correct parameters to verifyRegistrationResponse', async () => {
      verifyRegistrationResponse.mockResolvedValue({
        verified: false,
        registrationInfo: null,
      });

      await verifyAndStoreRegistration(mockUser, mockResponse, mockChallenge);

      expect(verifyRegistrationResponse).toHaveBeenCalledWith({
        response: mockResponse,
        expectedChallenge: mockChallenge,
        expectedOrigin: expect.any(String),
        expectedRPID: expect.any(String),
      });
    });
  });

  describe('generateAuthenticationOptionsForUser', () => {
    it('should return error when user is not found', async () => {
      users.findByName.mockReturnValue(null);

      const result = await generateAuthenticationOptionsForUser('nonexistent');

      expect(result).toEqual({ error: 'User not found' });
      expect(generateAuthenticationOptions).not.toHaveBeenCalled();
    });

    it('should return error when user has no passkeys registered', async () => {
      users.findByName.mockReturnValue({ id: 'user-123', name: 'TestUser' });
      passkeys.findByUserId.mockReturnValue([]);

      const result = await generateAuthenticationOptionsForUser('TestUser');

      expect(result).toEqual({ error: 'No passkeys registered for this user' });
      expect(generateAuthenticationOptions).not.toHaveBeenCalled();
    });

    it('should generate authentication options with allowed credentials', async () => {
      const mockUser = { id: 'user-123', name: 'TestUser' };
      const userPasskeys = [
        { credential_id: 'Y3JlZGVudGlhbC0x', transports: ['internal'] },
        { credential_id: 'Y3JlZGVudGlhbC0y', transports: ['usb', 'nfc'] },
      ];

      users.findByName.mockReturnValue(mockUser);
      passkeys.findByUserId.mockReturnValue(userPasskeys);
      generateAuthenticationOptions.mockResolvedValue({
        challenge: 'auth-challenge',
        allowCredentials: [
          { id: 'Y3JlZGVudGlhbC0x', transports: ['internal'] },
          { id: 'Y3JlZGVudGlhbC0y', transports: ['usb', 'nfc'] },
        ],
      });

      const result = await generateAuthenticationOptionsForUser('TestUser');

      expect(result.options).toBeDefined();
      expect(result.user).toEqual(mockUser);
    });

    it('should pass credential IDs as base64url strings, NOT as Buffers (simplewebauthn v10 requirement)', async () => {
      // CRITICAL TEST: This catches the bug where credential_id was passed as a Buffer
      // In simplewebauthn v10, allowCredentials[].id must be a base64url string
      const mockUser = { id: 'user-123', name: 'TestUser' };
      const base64urlCredentialId = 'dGVzdC1jcmVkZW50aWFsLWlk';
      const userPasskeys = [
        { credential_id: base64urlCredentialId, transports: ['internal'] },
      ];

      users.findByName.mockReturnValue(mockUser);
      passkeys.findByUserId.mockReturnValue(userPasskeys);
      generateAuthenticationOptions.mockResolvedValue({ challenge: 'auth-challenge' });

      await generateAuthenticationOptionsForUser('TestUser');

      const callArgs = generateAuthenticationOptions.mock.calls[0][0];

      // Verify the credential ID is passed as a string, not a Buffer
      expect(typeof callArgs.allowCredentials[0].id).toBe('string');
      expect(callArgs.allowCredentials[0].id).toBe(base64urlCredentialId);
      expect(Buffer.isBuffer(callArgs.allowCredentials[0].id)).toBe(false);
    });

    it('should handle multiple passkeys with different transports', async () => {
      const mockUser = { id: 'user-123', name: 'TestUser' };
      const userPasskeys = [
        { credential_id: 'cred1', transports: ['internal'] },
        { credential_id: 'cred2', transports: ['usb', 'nfc', 'ble'] },
        { credential_id: 'cred3', transports: null },
      ];

      users.findByName.mockReturnValue(mockUser);
      passkeys.findByUserId.mockReturnValue(userPasskeys);
      generateAuthenticationOptions.mockResolvedValue({ challenge: 'auth-challenge' });

      await generateAuthenticationOptionsForUser('TestUser');

      expect(generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: [
            { id: 'cred1', transports: ['internal'] },
            { id: 'cred2', transports: ['usb', 'nfc', 'ble'] },
            { id: 'cred3', transports: undefined },
          ],
        })
      );
    });

    it('should use preferred user verification', async () => {
      const mockUser = { id: 'user-123', name: 'TestUser' };
      users.findByName.mockReturnValue(mockUser);
      passkeys.findByUserId.mockReturnValue([{ credential_id: 'cred1', transports: [] }]);
      generateAuthenticationOptions.mockResolvedValue({ challenge: 'auth-challenge' });

      await generateAuthenticationOptionsForUser('TestUser');

      expect(generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          userVerification: 'preferred',
        })
      );
    });
  });

  describe('verifyAuthentication', () => {
    const mockUser = { id: 'user-123', name: 'TestUser' };
    const mockChallenge = 'expected-challenge';
    const mockResponse = {
      id: 'Y3JlZGVudGlhbC0x',
      rawId: 'Y3JlZGVudGlhbC0x',
      response: {
        clientDataJSON: 'mock-client-data',
        authenticatorData: 'mock-auth-data',
        signature: 'mock-signature',
      },
      type: 'public-key',
      authenticatorAttachment: 'platform',
    };

    it('should return error when passkey is not found', async () => {
      passkeys.findByCredentialId.mockReturnValue(null);

      const result = await verifyAuthentication(mockResponse, mockChallenge, mockUser);

      expect(result).toEqual({ verified: false, error: 'Passkey not found' });
      expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
    });

    it('should verify authentication and update counter on success', async () => {
      const mockPasskey = {
        id: 'passkey-1',
        credential_id: 'Y3JlZGVudGlhbC0x',
        public_key: Buffer.from([10, 20, 30, 40]).toString('base64'),
        counter: 5,
        transports: ['internal'],
      };

      passkeys.findByCredentialId.mockReturnValue(mockPasskey);
      verifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 6,
        },
      });

      const result = await verifyAuthentication(mockResponse, mockChallenge, mockUser);

      expect(result.verified).toBe(true);
      expect(result.user).toEqual(mockUser);
      expect(passkeys.updateCounter).toHaveBeenCalledWith('passkey-1', 6);
    });

    it('should return verified: false when verification fails', async () => {
      const mockPasskey = {
        id: 'passkey-1',
        credential_id: 'Y3JlZGVudGlhbC0x',
        public_key: Buffer.from([10, 20, 30, 40]).toString('base64'),
        counter: 5,
        transports: ['internal'],
      };

      passkeys.findByCredentialId.mockReturnValue(mockPasskey);
      verifyAuthenticationResponse.mockResolvedValue({
        verified: false,
      });

      const result = await verifyAuthentication(mockResponse, mockChallenge, mockUser);

      expect(result.verified).toBe(false);
      expect(passkeys.updateCounter).not.toHaveBeenCalled();
    });

    it('should decode credential_id from base64url for verifyAuthenticationResponse', async () => {
      const base64urlCredentialId = 'dGVzdC1jcmVkLWlk'; // "test-cred-id" in base64url
      const mockPasskey = {
        id: 'passkey-1',
        credential_id: base64urlCredentialId,
        public_key: Buffer.from([10, 20, 30, 40]).toString('base64'),
        counter: 5,
        transports: ['internal'],
      };

      passkeys.findByCredentialId.mockReturnValue(mockPasskey);
      verifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });

      await verifyAuthentication(
        { ...mockResponse, id: base64urlCredentialId },
        mockChallenge,
        mockUser
      );

      const callArgs = verifyAuthenticationResponse.mock.calls[0][0];

      // verifyAuthenticationResponse expects credential.id as a Buffer
      expect(Buffer.isBuffer(callArgs.credential.id)).toBe(true);
      expect(callArgs.credential.id).toEqual(Buffer.from(base64urlCredentialId, 'base64url'));
    });

    it('should decode public key from base64 storage format', async () => {
      const publicKeyBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const publicKeyBase64 = Buffer.from(publicKeyBytes).toString('base64');
      const mockPasskey = {
        id: 'passkey-1',
        credential_id: 'Y3JlZGVudGlhbC0x',
        public_key: publicKeyBase64,
        counter: 5,
        transports: ['internal'],
      };

      passkeys.findByCredentialId.mockReturnValue(mockPasskey);
      verifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });

      await verifyAuthentication(mockResponse, mockChallenge, mockUser);

      const callArgs = verifyAuthenticationResponse.mock.calls[0][0];

      // Public key should be a Uint8Array
      expect(callArgs.credential.publicKey).toBeInstanceOf(Uint8Array);
      expect(Array.from(callArgs.credential.publicKey)).toEqual(Array.from(publicKeyBytes));
    });

    it('should pass counter and transports to verifyAuthenticationResponse', async () => {
      const mockPasskey = {
        id: 'passkey-1',
        credential_id: 'Y3JlZGVudGlhbC0x',
        public_key: Buffer.from([10, 20, 30, 40]).toString('base64'),
        counter: 42,
        transports: ['usb', 'nfc', 'internal'],
      };

      passkeys.findByCredentialId.mockReturnValue(mockPasskey);
      verifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 43 },
      });

      await verifyAuthentication(mockResponse, mockChallenge, mockUser);

      const callArgs = verifyAuthenticationResponse.mock.calls[0][0];

      expect(callArgs.credential.counter).toBe(42);
      expect(callArgs.credential.transports).toEqual(['usb', 'nfc', 'internal']);
    });
  });

  describe('Credential ID Format Regression Tests', () => {
    /**
     * These tests specifically guard against the bug where credential IDs were passed
     * as Buffer objects instead of base64url strings to @simplewebauthn/server v10.
     *
     * In v10, the API expects:
     * - allowCredentials[].id: base64url string
     * - excludeCredentials[].id: base64url string
     *
     * The fix stores credential IDs as base64url strings in the database and passes
     * them directly to the simplewebauthn functions.
     */

    it('generateAuthenticationOptionsForUser: credential ID must be a string, not Buffer', async () => {
      const mockUser = { id: 'user-123', name: 'TestUser' };
      // Simulate what the database returns - stored as base64url string
      const storedCredentialId = 'SGVsbG8gV29ybGQ'; // "Hello World" in base64url

      users.findByName.mockReturnValue(mockUser);
      passkeys.findByUserId.mockReturnValue([
        { credential_id: storedCredentialId, transports: ['internal'] },
      ]);
      generateAuthenticationOptions.mockResolvedValue({ challenge: 'test' });

      await generateAuthenticationOptionsForUser('TestUser');

      const callArgs = generateAuthenticationOptions.mock.calls[0][0];
      const credentialId = callArgs.allowCredentials[0].id;

      // These assertions would FAIL if we were converting to Buffer
      expect(typeof credentialId).toBe('string');
      expect(credentialId).toBe(storedCredentialId);

      // This assertion explicitly checks it's NOT a Buffer
      expect(Buffer.isBuffer(credentialId)).toBe(false);
      expect(credentialId instanceof Uint8Array).toBe(false);
    });

    it('generateRegistrationOptionsForUser: excluded credential ID must be a string, not Buffer', async () => {
      const storedCredentialId = 'SGVsbG8gV29ybGQ';

      passkeys.findByUserId.mockReturnValue([
        { credential_id: storedCredentialId, transports: ['internal'] },
      ]);
      generateRegistrationOptions.mockResolvedValue({ challenge: 'test' });

      await generateRegistrationOptionsForUser({ id: 'user-123', name: 'TestUser' });

      const callArgs = generateRegistrationOptions.mock.calls[0][0];
      const credentialId = callArgs.excludeCredentials[0].id;

      expect(typeof credentialId).toBe('string');
      expect(credentialId).toBe(storedCredentialId);
      expect(Buffer.isBuffer(credentialId)).toBe(false);
    });

    it('should handle various base64url credential ID formats correctly', async () => {
      const mockUser = { id: 'user-123', name: 'TestUser' };
      // Various valid base64url strings
      const credentialIds = [
        'AQIDBAU', // Simple bytes
        'dGVzdC1jcmVkZW50aWFsLWlk', // "test-credential-id"
        '_-test_credential-', // Contains URL-safe characters
        'YQ', // Single character "a"
      ];

      users.findByName.mockReturnValue(mockUser);
      passkeys.findByUserId.mockReturnValue(
        credentialIds.map((id, i) => ({ credential_id: id, transports: [] }))
      );
      generateAuthenticationOptions.mockResolvedValue({ challenge: 'test' });

      await generateAuthenticationOptionsForUser('TestUser');

      const callArgs = generateAuthenticationOptions.mock.calls[0][0];

      credentialIds.forEach((expectedId, i) => {
        expect(callArgs.allowCredentials[i].id).toBe(expectedId);
        expect(typeof callArgs.allowCredentials[i].id).toBe('string');
      });
    });
  });
});
