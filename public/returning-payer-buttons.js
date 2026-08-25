const CUSTOMER_STORAGE_KEY = 'bt_returning_payer_buttons_customer_id';

let activeCustomer = null;
let payerMode = 'guest';
let clientInstance = null;
let dataCollectorInstance = null;
let paypalCheckoutInstance = null;
let hostedFieldsInstance = null;
let venmoInstance = null;
let hasVaultedPayPal = false;

const els = {
  modeGuest: document.getElementById('mode-guest'),
  modeReturning: document.getElementById('mode-returning'),
  guestFields: document.getElementById('guest-fields'),
  returningFields: document.getElementById('returning-fields'),
  guestEmail: document.getElementById('guest-email'),
  guestFirstName: document.getElementById('guest-first-name'),
  guestLastName: document.getElementById('guest-last-name'),
  returningCustomerId: document.getElementById('returning-customer-id'),
  returningEmail: document.getElementById('returning-email'),
  continueBtn: document.getElementById('continue-btn'),
  identityStatus: document.getElementById('identity-status'),
  stepCheckout: document.getElementById('step-checkout'),
  payerBadge: document.getElementById('payer-badge'),
  customerLabel: document.getElementById('customer-label'),
  activeCustomerId: document.getElementById('active-customer-id'),
  copyCustomerId: document.getElementById('copy-customer-id'),
  vaultedMethods: document.getElementById('vaulted-methods'),
  vaultedMethodsList: document.getElementById('vaulted-methods-list'),
  amount: document.getElementById('amount'),
  payLaterMessage: document.getElementById('pay-later-message'),
  paypalButton: document.getElementById('paypal-button'),
  paylaterButton: document.getElementById('paylater-button'),
  paylaterIneligible: document.getElementById('paylater-ineligible'),
  venmoButton: document.getElementById('venmo-button'),
  venmoUnsupported: document.getElementById('venmo-unsupported'),
  cardForm: document.getElementById('card-form'),
  cardSubmit: document.getElementById('card-submit'),
  resetBtn: document.getElementById('reset-btn'),
  result: document.getElementById('result'),
};

function setStatus(el, message, type = '') {
  el.textContent = message;
  el.className = `status-line ${type}`.trim();
}

function showResult(message, type = 'info', details = null) {
  els.result.hidden = false;
  els.result.className = `result ${type}`;
  let html = message;
  if (details) {
    html += `\n<pre>${JSON.stringify(details, null, 2)}</pre>`;
  }
  els.result.innerHTML = html;
  els.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResult() {
  els.result.hidden = true;
  els.result.innerHTML = '';
}

function currentAmount() {
  const value = parseFloat(els.amount.value);
  return !isNaN(value) && value > 0 ? value.toFixed(2) : '30.00';
}

function setMode(mode) {
  payerMode = mode;
  els.modeGuest.classList.toggle('active', mode === 'guest');
  els.modeReturning.classList.toggle('active', mode === 'returning');
  els.guestFields.hidden = mode !== 'guest';
  els.returningFields.hidden = mode !== 'returning';
  setStatus(els.identityStatus, '');
}

els.modeGuest.addEventListener('click', () => setMode('guest'));
els.modeReturning.addEventListener('click', () => setMode('returning'));

const storedId = localStorage.getItem(CUSTOMER_STORAGE_KEY);
if (storedId) {
  els.returningCustomerId.value = storedId;
}

async function ensureCustomer() {
  if (payerMode === 'guest') {
    const email = els.guestEmail.value.trim();
    if (!email) throw new Error('Email is required for guest checkout.');

    const response = await fetch('/api/customer/ensure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        firstName: els.guestFirstName.value.trim() || 'Guest',
        lastName: els.guestLastName.value.trim() || 'Customer',
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to create/find guest customer');
    }
    return {
      customer: data.customer,
      wasCreated: data.created,
      mode: data.created ? 'guest' : 'returning',
    };
  }

  const customerId = els.returningCustomerId.value.trim();
  const email = els.returningEmail.value.trim();
  if (!customerId && !email) {
    throw new Error('Enter a Customer ID or email for returning payer.');
  }

  const response = await fetch('/api/customer/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(customerId ? { customerId } : { email }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Returning customer not found');
  }
  return { customer: data.customer, wasCreated: false, mode: 'returning' };
}

function renderCustomerBanner(customer, mode) {
  activeCustomer = customer;
  localStorage.setItem(CUSTOMER_STORAGE_KEY, customer.id);

  els.payerBadge.textContent = mode === 'returning' ? 'Returning' : 'Guest';
  els.payerBadge.classList.toggle('returning', mode === 'returning');

  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
  els.customerLabel.textContent = name
    ? `${name}${customer.email ? ` · ${customer.email}` : ''}`
    : customer.email || 'Customer';
  els.activeCustomerId.textContent = customer.id;

  hasVaultedPayPal = (customer.paymentMethods || []).some(
    (m) => m.type === 'PayPalAccount',
  );

  const methods = customer.paymentMethods || [];
  if (methods.length > 0) {
    els.vaultedMethods.hidden = false;
    els.vaultedMethodsList.innerHTML = methods
      .map(
        (m) => `
        <button type="button" class="vault-pay-btn" data-token="${m.token}">
          <strong>${m.type}</strong> — ${m.label}${m.default ? ' (default)' : ''}
        </button>`,
      )
      .join('');

    els.vaultedMethodsList.querySelectorAll('.vault-pay-btn').forEach((btn) => {
      btn.addEventListener('click', () =>
        processSale({ paymentMethodToken: btn.dataset.token }),
      );
    });
  } else {
    els.vaultedMethods.hidden = true;
    els.vaultedMethodsList.innerHTML = '';
  }
}

async function resetPayPalSdk() {
  if (paypalCheckoutInstance && typeof paypalCheckoutInstance.teardown === 'function') {
    try {
      await paypalCheckoutInstance.teardown();
    } catch (e) {
      /* ignore */
    }
  }
  paypalCheckoutInstance = null;

  // loadPayPalSDK only injects once; clear it so returning-customer
  // user-id-token / enable-funding options actually apply on re-init.
  document
    .querySelectorAll(
      'script[src*="paypal.com/sdk/js"], script[src*="paypalObjects"]',
    )
    .forEach((script) => script.remove());
  if (window.paypal) {
    try {
      delete window.paypal;
    } catch (e) {
      window.paypal = undefined;
    }
  }
}

async function teardownPaymentUi() {
  if (hostedFieldsInstance) {
    try {
      await hostedFieldsInstance.teardown();
    } catch (e) {
      /* ignore */
    }
    hostedFieldsInstance = null;
  }
  if (venmoInstance) {
    try {
      await venmoInstance.teardown();
    } catch (e) {
      /* ignore */
    }
    venmoInstance = null;
  }
  await resetPayPalSdk();
  clientInstance = null;
  dataCollectorInstance = null;
  els.paypalButton.innerHTML = '';
  els.paylaterButton.innerHTML = '';
  els.venmoButton.innerHTML = '';
  els.cardSubmit.disabled = true;
  els.paylaterIneligible.hidden = true;
  els.venmoUnsupported.hidden = true;
}

async function processSale({ paymentMethodNonce, paymentMethodToken }) {
  if (!activeCustomer) {
    showResult('Complete step 1 first.', 'error');
    return;
  }

  const amount = currentAmount();
  hideResult();
  showResult('Processing payment…', 'info');

  try {
    const body = {
      amount,
      customerId: activeCustomer.id,
      vault: true,
      deviceData: dataCollectorInstance?.deviceData || null,
      customer: {
        email: activeCustomer.email,
        firstName: activeCustomer.firstName,
        lastName: activeCustomer.lastName,
      },
      options: { storeInVault: true, storeInVaultOnSuccess: true },
    };
    if (paymentMethodNonce) body.paymentMethodNonce = paymentMethodNonce;
    if (paymentMethodToken) body.paymentMethodToken = paymentMethodToken;

    const response = await fetch('/api/sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Payment failed');
    }

    const txn = result.transaction;
    const vault = result.vaultedPaymentMethod;
    const customerId =
      vault?.customerId || txn.customer?.id || activeCustomer.id;

    let message = `<strong>Payment successful</strong>\n`;
    message += `Transaction: ${txn.id}\n`;
    message += `Status: ${txn.status}\n`;
    message += `Amount: $${txn.amount}\n`;
    message += `Instrument: ${txn.paymentInstrumentType || '—'}\n`;
    message += `Customer ID: ${customerId}\n`;
    if (vault?.token) {
      message += `\nVaulted token: ${vault.token}`;
      if (vault.paymentType) message += ` (${vault.paymentType})`;
      if (vault.email) message += `\nPayPal: ${vault.email}`;
      if (vault.username) message += `\nVenmo: @${vault.username}`;
    }

    showResult(message, 'success', {
      transaction: txn,
      vaultedPaymentMethod: vault,
    });

    const refresh = await fetch(`/api/customer/${encodeURIComponent(customerId)}`);
    const refreshData = await refresh.json();
    if (refreshData.success) {
      renderCustomerBanner(
        refreshData.customer,
        refreshData.customer.paymentMethodCount > 0 ? 'returning' : payerMode,
      );
    }
  } catch (error) {
    console.error(error);
    showResult(error.message || String(error), 'error');
  }
}

async function initializeHostedFields() {
  hostedFieldsInstance = await braintree.hostedFields.create({
    client: clientInstance,
    styles: {
      input: {
        'font-size': '16px',
        'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
        color: '#333',
      },
    },
    fields: {
      number: { selector: '#card-number', placeholder: '4111 1111 1111 1111' },
      expirationDate: { selector: '#expiration-date', placeholder: 'MM/YY' },
      cvv: { selector: '#cvv', placeholder: '123' },
    },
  });

  hostedFieldsInstance.on('validityChange', () => {
    const state = hostedFieldsInstance.getState();
    const valid = Object.keys(state.fields).every(
      (key) => state.fields[key].isValid,
    );
    els.cardSubmit.disabled = !valid;
  });
}

async function initializeVenmo() {
  try {
    venmoInstance = await braintree.venmo.create({
      client: clientInstance,
      allowDesktop: true,
      mobileWebFallBack: true,
      paymentMethodUsage: 'multi_use',
      enableVenmoSandbox: true,
    });

    if (!venmoInstance.isBrowserSupported()) {
      els.venmoUnsupported.hidden = false;
      return;
    }

    els.venmoButton.innerHTML = `
      <button type="button" class="venmo-button" id="venmo-pay-btn">Pay with Venmo &amp; vault</button>
    `;
    document.getElementById('venmo-pay-btn').addEventListener('click', async () => {
      try {
        const payload = await venmoInstance.tokenize();
        await processSale({ paymentMethodNonce: payload.nonce });
      } catch (error) {
        if (error.code === 'VENMO_CANCELED' || error.code === 'VENMO_CANCELLED') {
          showResult('Venmo cancelled.', 'info');
        } else {
          showResult(error.message || 'Venmo failed.', 'error');
        }
      }
    });
  } catch (error) {
    console.warn('Venmo unavailable:', error);
    els.venmoUnsupported.hidden = false;
    els.venmoUnsupported.textContent =
      'Venmo not available (sandbox enablement/profile may be required).';
  }
}

function buildCreatePayment(options = {}) {
  return () => {
    const amount = currentAmount();
    const payment = {
      flow: 'checkout',
      amount,
      currency: 'USD',
      intent: 'capture',
      enableShippingAddress: false,
      ...options,
    };
    return paypalCheckoutInstance.createPayment(payment);
  };
}

async function initializePayPalButtons() {
  const amount = currentAmount();
  els.payLaterMessage.setAttribute('data-pp-amount', amount);
  els.paypalButton.innerHTML = '';
  els.paylaterButton.innerHTML = '';
  els.paylaterIneligible.hidden = true;

  // Always on: checkout uses a customer-scoped client token. Required so
  // returning payers with a vaulted PayPal BA can still see Pay Later.
  paypalCheckoutInstance = await braintree.paypalCheckout.create({
    client: clientInstance,
    autoSetDataUserIdToken: true,
  });

  await paypalCheckoutInstance.loadPayPalSDK({
    currency: 'USD',
    intent: 'capture',
    commit: true,
    components: 'buttons,messages',
    'enable-funding': 'paylater',
    dataAttributes: {
      amount,
    },
  });

  const sharedHandlers = {
    onApprove: async (data) => {
      const payload = await paypalCheckoutInstance.tokenizePayment(data);
      await processSale({ paymentMethodNonce: payload.nonce });
    },
    onCancel: () => showResult('PayPal checkout cancelled.', 'info'),
    onError: (err) => {
      console.error(err);
      showResult(err.message || 'PayPal error', 'error');
    },
  };

  // Pay Later first — standalone one-time checkout (never requestBillingAgreement)
  const payLaterBtn = paypal.Buttons({
    fundingSource: paypal.FUNDING.PAYLATER,
    style: { layout: 'vertical', color: 'gold', shape: 'rect' },
    createOrder: buildCreatePayment(),
    ...sharedHandlers,
  });

  if (payLaterBtn.isEligible()) {
    els.paylaterIneligible.hidden = true;
    await payLaterBtn.render('#paylater-button');
  } else {
    els.paylaterIneligible.hidden = false;
    console.warn('Pay Later isEligible() returned false', {
      amount,
      hasVaultedPayPal,
      customerId: activeCustomer?.id,
    });
  }

  // PayPal Wallet:
  // - No vaulted BA yet → Checkout with Vault (requestBillingAgreement)
  // - Already vaulted → one-time checkout (required for Pay Later + returning BA)
  const paypalCreateOptions = hasVaultedPayPal
    ? {}
    : {
        requestBillingAgreement: true,
        billingAgreementDetails: {
          description: 'Save PayPal for future purchases',
        },
      };

  const paypalBtn = paypal.Buttons({
    fundingSource: paypal.FUNDING.PAYPAL,
    style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
    createOrder: buildCreatePayment(paypalCreateOptions),
    ...sharedHandlers,
  });

  if (paypalBtn.isEligible()) {
    await paypalBtn.render('#paypal-button');
  } else {
    els.paypalButton.innerHTML =
      '<p class="hint">PayPal button not eligible in this environment.</p>';
  }
}

async function initializeCheckout(customerId) {
  await teardownPaymentUi();

  const tokenRes = await fetch(
    `/client_token?customerId=${encodeURIComponent(customerId)}`,
  );
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.clientToken) {
    throw new Error(tokenData.error || 'Failed to get client token');
  }

  clientInstance = await braintree.client.create({
    authorization: tokenData.clientToken,
  });

  dataCollectorInstance = await braintree.dataCollector.create({
    client: clientInstance,
    paypal: true,
  });

  await initializeHostedFields();
  await initializePayPalButtons();
  await initializeVenmo();
}

els.continueBtn.addEventListener('click', async () => {
  hideResult();
  els.continueBtn.disabled = true;
  setStatus(els.identityStatus, 'Looking up / creating customer…');

  try {
    const { customer, wasCreated, mode } = await ensureCustomer();
    renderCustomerBanner(customer, mode);
    setStatus(
      els.identityStatus,
      wasCreated
        ? `Guest customer created (${customer.id}). Loading payment UI…`
        : `Customer found (${customer.id}). Loading payment UI…`,
      'ok',
    );

    await initializeCheckout(customer.id);

    els.stepCheckout.hidden = false;
    setStatus(
      els.identityStatus,
      'Ready — use PayPal, Pay Later, Venmo, card, or a saved vault token.',
      'ok',
    );
    els.stepCheckout.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error(error);
    setStatus(els.identityStatus, error.message || String(error), 'err');
    showResult(error.message || String(error), 'error');
  } finally {
    els.continueBtn.disabled = false;
  }
});

els.copyCustomerId.addEventListener('click', async () => {
  if (!activeCustomer?.id) return;
  try {
    await navigator.clipboard.writeText(activeCustomer.id);
    els.copyCustomerId.textContent = 'Copied';
    setTimeout(() => {
      els.copyCustomerId.textContent = 'Copy';
    }, 1200);
  } catch (e) {
    showResult('Could not copy Customer ID.', 'error');
  }
});

els.cardForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!hostedFieldsInstance) return;
  els.cardSubmit.disabled = true;
  try {
    const payload = await hostedFieldsInstance.tokenize();
    await processSale({ paymentMethodNonce: payload.nonce });
  } catch (error) {
    showResult(error.message || 'Card tokenization failed.', 'error');
  } finally {
    const state = hostedFieldsInstance?.getState?.();
    if (state) {
      const valid = Object.keys(state.fields).every(
        (key) => state.fields[key].isValid,
      );
      els.cardSubmit.disabled = !valid;
    }
  }
});

els.amount.addEventListener('change', async () => {
  if (!clientInstance || !activeCustomer) return;
  const amount = currentAmount();
  els.payLaterMessage.setAttribute('data-pp-amount', amount);
  try {
    await resetPayPalSdk();
    await initializePayPalButtons();
  } catch (error) {
    console.warn('Could not refresh PayPal buttons:', error);
  }
});

els.resetBtn.addEventListener('click', async () => {
  await teardownPaymentUi();
  els.stepCheckout.hidden = true;
  activeCustomer = null;
  hideResult();
  setStatus(els.identityStatus, 'Ready for a new guest or returning payer.');
});
