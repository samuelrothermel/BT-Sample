const PROFILE_STORAGE_KEY = 'bt_venmo_profile_id';

let venmoInstance = null;
let dataCollectorInstance = null;
let clientInstance = null;
let venmoConfigMeta = null;

const els = {
  sandboxPublicId: document.getElementById('sandbox-public-id'),
  merchantId: document.getElementById('merchant-id'),
  environment: document.getElementById('environment'),
  copyPublicId: document.getElementById('copy-public-id'),
  profileId: document.getElementById('venmo-profile-id'),
  enableSandbox: document.getElementById('enable-venmo-sandbox'),
  initBtn: document.getElementById('init-venmo-btn'),
  initStatus: document.getElementById('init-status'),
  customerName: document.getElementById('customer-name'),
  itemName: document.getElementById('item-name'),
  amount: document.getElementById('amount'),
  summaryItem: document.getElementById('summary-item'),
  summaryCustomer: document.getElementById('summary-customer'),
  summaryTotal: document.getElementById('summary-total'),
  venmoUnsupported: document.getElementById('venmo-unsupported'),
  venmoButton: document.getElementById('venmo-button'),
  usernameLive: document.getElementById('venmo-username-live'),
  usernameValue: document.getElementById('venmo-username-value'),
  postPurchase: document.getElementById('post-purchase'),
  postItem: document.getElementById('post-item'),
  postCustomer: document.getElementById('post-customer'),
  postVenmoUsername: document.getElementById('post-venmo-username'),
  postTotal: document.getElementById('post-total'),
  authResult: document.getElementById('auth-result'),
  result: document.getElementById('result'),
};

function formatUsd(amount) {
  const n = parseFloat(amount);
  if (isNaN(n)) return '$0.00 USD';
  return `$${n.toFixed(2)} USD`;
}

function updatePreSummary() {
  els.summaryItem.textContent = els.itemName.value || '—';
  els.summaryCustomer.textContent = els.customerName.value || '—';
  els.summaryTotal.textContent = formatUsd(els.amount.value);
}

function showResult(message, type = 'info') {
  els.result.hidden = false;
  els.result.className = `result ${type}`;
  els.result.textContent = message;
}

function setInitStatus(message, type = '') {
  els.initStatus.textContent = message;
  els.initStatus.className = `status-line ${type}`.trim();
}

function splitCustomerName(fullName) {
  const parts = (fullName || 'Customer').trim().split(/\s+/);
  return {
    firstName: parts[0] || 'Customer',
    lastName: parts.slice(1).join(' ') || '',
  };
}

async function loadVenmoConfig() {
  const response = await fetch('/api/venmo-config');
  if (!response.ok) {
    throw new Error('Failed to load Venmo config');
  }
  venmoConfigMeta = await response.json();

  els.sandboxPublicId.textContent =
    venmoConfigMeta.sandboxPublicId || 'Not configured in .env';
  els.merchantId.textContent = venmoConfigMeta.merchantId || 'Not configured';
  els.environment.textContent = venmoConfigMeta.environment || 'sandbox';

  if (venmoConfigMeta.sandboxPublicId) {
    els.copyPublicId.disabled = false;
  }

  const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
  const fromEnv = venmoConfigMeta.venmoProfileId;
  if (stored) {
    els.profileId.value = stored;
  } else if (fromEnv) {
    els.profileId.value = fromEnv;
  }

  // Match server environment: sandbox checkbox on by default only in sandbox
  els.enableSandbox.checked = venmoConfigMeta.enableVenmoSandbox !== false;
}

els.copyPublicId.addEventListener('click', async () => {
  const value = venmoConfigMeta?.sandboxPublicId;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    els.copyPublicId.textContent = 'Copied';
    setTimeout(() => {
      els.copyPublicId.textContent = 'Copy';
    }, 1500);
  } catch (err) {
    showResult('Could not copy to clipboard. Select and copy manually.', 'error');
  }
});

['customer-name', 'item-name', 'amount'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updatePreSummary);
});

els.profileId.addEventListener('change', () => {
  const value = els.profileId.value.trim();
  if (value) {
    localStorage.setItem(PROFILE_STORAGE_KEY, value);
  } else {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
  }
});

async function teardownVenmo() {
  if (venmoInstance && typeof venmoInstance.teardown === 'function') {
    try {
      await venmoInstance.teardown();
    } catch (e) {
      console.warn('Venmo teardown warning:', e);
    }
  }
  venmoInstance = null;
  els.venmoButton.innerHTML = '';
  els.venmoUnsupported.hidden = true;
}

async function initializeVenmo() {
  const profileId = els.profileId.value.trim();
  if (!profileId) {
    setInitStatus(
      'Enter the Venmo Profile ID from enablement before initializing.',
      'err',
    );
    return;
  }

  localStorage.setItem(PROFILE_STORAGE_KEY, profileId);
  els.initBtn.disabled = true;
  setInitStatus('Fetching client token and creating Venmo component…');

  try {
    await teardownVenmo();

    const tokenRes = await fetch('/client_token');
    const tokenData = await tokenRes.json();
    if (!tokenData.clientToken) {
      throw new Error(tokenData.error || 'No client token returned');
    }

    clientInstance = await braintree.client.create({
      authorization: tokenData.clientToken,
    });

    dataCollectorInstance = await braintree.dataCollector.create({
      client: clientInstance,
    });

    const createOptions = {
      client: clientInstance,
      profileId,
      paymentMethodUsage: 'single_use',
      allowDesktop: true,
      mobileWebFallBack: true,
    };

    if (els.enableSandbox.checked) {
      createOptions.enableVenmoSandbox = true;
    }

    console.log('Creating Venmo with options:', {
      ...createOptions,
      client: '[clientInstance]',
    });

    venmoInstance = await braintree.venmo.create(createOptions);

    if (!venmoInstance.isBrowserSupported()) {
      els.venmoUnsupported.hidden = false;
      setInitStatus(
        'Venmo component created, but this browser is not supported.',
        'err',
      );
      els.initBtn.disabled = false;
      return;
    }

    renderVenmoButton();
    setInitStatus(
      'Venmo ready. Desktop QR and mobile web fallback are enabled.',
      'ok',
    );
  } catch (error) {
    console.error('Venmo init error:', error);
    setInitStatus(
      error.message ||
        'Failed to initialize Venmo. Confirm sandbox whitelist + profile ID.',
      'err',
    );
    showResult(
      `Venmo initialization failed: ${error.message || error}\n\nIf enablement is not confirmed yet, sandbox calls will fail even with correct wiring.`,
      'error',
    );
  } finally {
    els.initBtn.disabled = false;
  }
}

function renderVenmoButton() {
  els.venmoUnsupported.hidden = true;
  els.venmoButton.innerHTML = `
    <button type="button" class="venmo-button" id="venmo-pay-button">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M15.8 2.2c1.1 1.7 1.6 3.6 1.6 5.8 0 5.1-2.8 10.7-7.9 16h-4L2.2 2.2h4.6l1.9 14.1c2.4-3.5 3.8-7 3.8-10.1 0-1.5-.3-2.9-.8-4h4.1z"/>
      </svg>
      Pay with Venmo
    </button>
  `;

  const button = document.getElementById('venmo-pay-button');
  button.addEventListener('click', onVenmoClick);
}

async function onVenmoClick() {
  const amount = els.amount.value;
  if (!amount || parseFloat(amount) <= 0) {
    showResult('Enter a valid USD amount.', 'error');
    return;
  }

  if (!venmoInstance) {
    showResult('Initialize Venmo first.', 'error');
    return;
  }

  updatePreSummary();
  els.postPurchase.hidden = true;
  els.usernameLive.hidden = true;

  const button = document.getElementById('venmo-pay-button');
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span> Connecting to Venmo…`;

  try {
    const payload = await venmoInstance.tokenize();
    console.log('Venmo tokenize payload:', payload);

    const username =
      payload.details?.username ||
      payload.details?.userName ||
      payload.username ||
      '—';

    els.usernameValue.textContent = username;
    els.usernameLive.hidden = false;

    const customer = splitCustomerName(els.customerName.value);
    const deviceData = dataCollectorInstance
      ? dataCollectorInstance.deviceData
      : null;

    const authRes = await fetch('/api/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethodNonce: payload.nonce,
        amount,
        deviceData,
        customer,
      }),
    });

    const result = await authRes.json();
    if (!authRes.ok || !result.success) {
      throw new Error(result.error || 'Authorization failed');
    }

    const txn = result.transaction;
    const txnUsername =
      txn.venmoAccount?.username || username;

    els.postItem.textContent = els.itemName.value;
    els.postCustomer.textContent = els.customerName.value;
    els.postVenmoUsername.textContent = txnUsername;
    els.postTotal.textContent = formatUsd(txn.amount || amount);
    els.postPurchase.hidden = false;

    els.authResult.className = 'result success';
    els.authResult.innerHTML = `
<strong>Authorization created (not settled)</strong>
Transaction ID: ${txn.id}
Status: ${txn.status}
Amount: ${txn.amount} ${txn.currencyIsoCode || 'USD'}
Payment instrument: ${txn.paymentInstrumentType || 'venmo_account'}
Venmo username: ${txnUsername}

Capture later within ~10 days. Sandbox will not show a Venmo balance debit.
<pre>${JSON.stringify(txn, null, 2)}</pre>
    `.trim();

    showResult('Venmo authorization succeeded.', 'success');
  } catch (error) {
    console.error('Venmo payment error:', error);
    if (error.code === 'VENMO_CANCELED' || error.code === 'VENMO_CANCELLED') {
      showResult('Venmo payment was cancelled.', 'info');
    } else {
      showResult(
        `Venmo payment failed: ${error.message || error}`,
        'error',
      );
    }
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
}

els.initBtn.addEventListener('click', initializeVenmo);

(async function boot() {
  updatePreSummary();
  try {
    await loadVenmoConfig();
    if (els.profileId.value.trim()) {
      setInitStatus(
        'Profile ID loaded. Click Initialize Venmo when ready to test.',
      );
    } else {
      setInitStatus(
        'Waiting for Venmo Profile ID after sandbox Public ID enablement.',
      );
    }
  } catch (error) {
    console.error(error);
    setInitStatus('Could not load /api/venmo-config. Is the server running?', 'err');
  }
})();
