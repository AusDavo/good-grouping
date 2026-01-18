// Profile Passkey Management

/**
 * Initialize passkey management on the profile page
 */
function initPasskeyManagement() {
  loadPasskeys();

  const addBtn = document.getElementById('add-passkey-btn');
  if (addBtn) {
    addBtn.addEventListener('click', handleAddPasskey);
  }
}

/**
 * Load and display user's passkeys
 */
async function loadPasskeys() {
  const listEl = document.getElementById('passkeys-list');
  if (!listEl) return;

  try {
    const res = await fetch('/profile/passkeys');
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to load passkeys');
    }

    const { passkeys, authMethods } = await res.json();

    if (passkeys.length === 0) {
      listEl.innerHTML = '<p class="text-sm text-pub-chalk-accent italic">No passkeys registered</p>';
      return;
    }

    listEl.innerHTML = passkeys.map(pk => {
      const date = new Date(pk.created_at).toLocaleDateString();
      const deleteBtn = pk.canDelete
        ? `<button type="button" onclick="handleDeletePasskey('${pk.id}')" class="text-sm text-neon-orange hover:text-red-400 transition-colors">Delete</button>`
        : `<span class="text-xs text-pub-chalk-accent">Only auth method</span>`;

      return `
        <div class="flex items-center justify-between bg-pub-green-900/50 rounded-lg p-3">
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-neon-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
            <div>
              <p class="text-sm text-pub-chalk-text">Passkey</p>
              <p class="text-xs text-pub-chalk-accent">Added ${date}</p>
            </div>
          </div>
          ${deleteBtn}
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Load passkeys error:', error);
    listEl.innerHTML = '<p class="text-sm text-neon-orange">Failed to load passkeys</p>';
  }
}

/**
 * Handle adding a new passkey
 */
async function handleAddPasskey() {
  const addBtn = document.getElementById('add-passkey-btn');
  const errorEl = document.getElementById('passkey-error');
  const successEl = document.getElementById('passkey-success');

  addBtn.disabled = true;
  errorEl.classList.add('hidden');
  successEl.classList.add('hidden');

  try {
    // Get registration options from server
    const optionsRes = await fetch('/profile/passkeys/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!optionsRes.ok) {
      const data = await optionsRes.json();
      throw new Error(data.error || 'Failed to get registration options');
    }

    const options = await optionsRes.json();

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

    // Verify with server
    const verifyRes = await fetch('/profile/passkeys/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    });

    const result = await verifyRes.json();

    if (result.success) {
      successEl.textContent = 'Passkey added successfully!';
      successEl.classList.remove('hidden');
      loadPasskeys();
    } else {
      throw new Error(result.error || 'Failed to add passkey');
    }
  } catch (error) {
    console.error('Add passkey error:', error);
    if (error.name === 'NotAllowedError') {
      errorEl.textContent = 'Passkey creation was cancelled or not allowed';
    } else {
      errorEl.textContent = error.message || 'Failed to add passkey';
    }
    errorEl.classList.remove('hidden');
  } finally {
    addBtn.disabled = false;
  }
}

/**
 * Handle deleting a passkey
 * @param {string} passkeyId
 */
async function handleDeletePasskey(passkeyId) {
  if (!confirm('Are you sure you want to delete this passkey?')) {
    return;
  }

  const errorEl = document.getElementById('passkey-error');
  const successEl = document.getElementById('passkey-success');

  errorEl.classList.add('hidden');
  successEl.classList.add('hidden');

  try {
    const res = await fetch(`/profile/passkeys/${passkeyId}/delete`, {
      method: 'POST',
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || 'Failed to delete passkey');
    }

    successEl.textContent = 'Passkey deleted successfully!';
    successEl.classList.remove('hidden');
    loadPasskeys();
  } catch (error) {
    console.error('Delete passkey error:', error);
    errorEl.textContent = error.message || 'Failed to delete passkey';
    errorEl.classList.remove('hidden');
  }
}
