// Helper to convert base64url to ArrayBuffer
function base64urlToBuffer(base64url) {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + padding;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper to convert ArrayBuffer to base64url
function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Handle login form submission
async function handleLogin(event) {
  event.preventDefault();

  const statusEl = document.getElementById('login-status');
  const username = document.getElementById('username').value.trim();

  if (!username) {
    statusEl.textContent = 'Please enter your name';
    statusEl.className = 'status-message alert alert-error';
    return;
  }

  statusEl.textContent = 'Starting authentication...';
  statusEl.className = 'status-message';

  try {
    // Get authentication options from server
    const optionsRes = await fetch('/login/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });

    const options = await optionsRes.json();

    if (options.error) {
      statusEl.textContent = options.error;
      statusEl.className = 'status-message alert alert-error';
      return;
    }

    // Convert challenge from base64url
    options.challenge = base64urlToBuffer(options.challenge);

    // Convert allowCredentials if present
    if (options.allowCredentials) {
      options.allowCredentials = options.allowCredentials.map(cred => ({
        ...cred,
        id: base64urlToBuffer(cred.id),
      }));
    }

    statusEl.textContent = 'Please authenticate with your passkey...';

    // Call WebAuthn API
    const credential = await navigator.credentials.get({
      publicKey: options,
    });

    // Prepare response for server
    const response = {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      response: {
        authenticatorData: bufferToBase64url(credential.response.authenticatorData),
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
        signature: bufferToBase64url(credential.response.signature),
        userHandle: credential.response.userHandle
          ? bufferToBase64url(credential.response.userHandle)
          : null,
      },
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      authenticatorAttachment: credential.authenticatorAttachment,
    };

    statusEl.textContent = 'Verifying...';

    // Verify with server
    const verifyRes = await fetch('/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    });

    const result = await verifyRes.json();

    if (result.success) {
      statusEl.textContent = 'Login successful! Redirecting...';
      statusEl.className = 'status-message alert alert-success';
      window.location.href = result.redirect || '/';
    } else {
      statusEl.textContent = result.error || 'Login failed';
      statusEl.className = 'status-message alert alert-error';
    }
  } catch (error) {
    console.error('Login error:', error);
    if (error.name === 'NotAllowedError') {
      statusEl.textContent = 'Authentication was cancelled or not allowed';
    } else {
      statusEl.textContent = 'Authentication failed: ' + error.message;
    }
    statusEl.className = 'status-message alert alert-error';
  }
}

// Handle registration form submission
async function handleRegister(event) {
  event.preventDefault();

  const statusEl = document.getElementById('register-status');
  const token = document.getElementById('token').value;
  const username = document.getElementById('username').value.trim();

  if (!username) {
    statusEl.textContent = 'Please enter your name';
    statusEl.className = 'status-message alert alert-error';
    return;
  }

  statusEl.textContent = 'Starting registration...';
  statusEl.className = 'status-message';

  try {
    // Get registration options from server
    const optionsRes = await fetch('/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, username }),
    });

    const options = await optionsRes.json();

    if (options.error) {
      statusEl.textContent = options.error;
      statusEl.className = 'status-message alert alert-error';
      return;
    }

    // Convert challenge and user.id from base64url
    options.challenge = base64urlToBuffer(options.challenge);
    options.user.id = base64urlToBuffer(options.user.id);

    // Convert excludeCredentials if present
    if (options.excludeCredentials) {
      options.excludeCredentials = options.excludeCredentials.map(cred => ({
        ...cred,
        id: base64urlToBuffer(cred.id),
      }));
    }

    statusEl.textContent = 'Please create your passkey...';

    // Call WebAuthn API
    const credential = await navigator.credentials.create({
      publicKey: options,
    });

    // Prepare response for server
    const response = {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      response: {
        attestationObject: bufferToBase64url(credential.response.attestationObject),
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
        transports: credential.response.getTransports ? credential.response.getTransports() : [],
        publicKeyAlgorithm: credential.response.getPublicKeyAlgorithm
          ? credential.response.getPublicKeyAlgorithm()
          : null,
        publicKey: credential.response.getPublicKey
          ? bufferToBase64url(credential.response.getPublicKey())
          : null,
        authenticatorData: credential.response.getAuthenticatorData
          ? bufferToBase64url(credential.response.getAuthenticatorData())
          : null,
      },
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      authenticatorAttachment: credential.authenticatorAttachment,
    };

    statusEl.textContent = 'Verifying registration...';

    // Verify with server
    const verifyRes = await fetch('/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    });

    const result = await verifyRes.json();

    if (result.success) {
      statusEl.textContent = 'Registration successful! Redirecting...';
      statusEl.className = 'status-message alert alert-success';
      window.location.href = result.redirect || '/';
    } else {
      statusEl.textContent = result.error || 'Registration failed';
      statusEl.className = 'status-message alert alert-error';
    }
  } catch (error) {
    console.error('Registration error:', error);
    if (error.name === 'NotAllowedError') {
      statusEl.textContent = 'Passkey creation was cancelled or not allowed';
    } else {
      statusEl.textContent = 'Registration failed: ' + error.message;
    }
    statusEl.className = 'status-message alert alert-error';
  }
}

// Check for WebAuthn support and attach event listeners on page load
document.addEventListener('DOMContentLoaded', function() {
  // Attach login handler
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  // Attach register handler
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegister);
  }

  // Check for WebAuthn support
  if (!window.PublicKeyCredential) {
    const forms = document.querySelectorAll('#login-form, #register-form');
    forms.forEach(form => {
      const warning = document.createElement('div');
      warning.className = 'alert alert-error';
      warning.textContent = 'Your browser does not support passkeys. Please use a modern browser.';
      form.prepend(warning);
      form.querySelector('button[type="submit"]').disabled = true;
    });
  }
});
