const CUSTOMER_STORAGE_KEY = 'bt_returning_payer_customer_id';

let dropinInstance = null;
let activeCustomer = null;
let payerMode = 'guest'; // 'guest' | 'returning'

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
  dropinContainer: document.getElementById('dropin-container'),
  submitButton: document.getElementById('submit-button'),
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
    if (!email) {
      throw new Error('Email is required for guest checkout.');
    }
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
  return {
    customer: data.customer,
    wasCreated: false,
    mode: 'returning',
  };
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

  const methods = customer.paymentMethods || [];
  if (methods.length > 0) {
    els.vaultedMethods.hidden = false;
    els.vaultedMethodsList.innerHTML = methods
      .map(
        (m) =>
          `<li><strong>${m.type}</strong> — ${m.label}${
            m.default ? ' (default)' : ''
          }</li>`,
      )
      .join('');
  } else {
    els.vaultedMethods.hidden = true;
    els.vaultedMethodsList.innerHTML = '';
  }
}

async function teardownDropin() {
  if (dropinInstance) {
    try {
      await dropinInstance.teardown();
    } catch (e) {
      console.warn('Drop-in teardown:', e);
    }
    dropinInstance = null;
  }
  els.dropinContainer.innerHTML = '';
  els.submitButton.disabled = true;
}

function currentAmount() {
  const value = parseFloat(els.amount.value);
  return !isNaN(value) && value > 0 ? value.toFixed(2) : '30.00';
}

function buildDropinOptions(clientToken, amount) {
  return {
    authorization: clientToken,
    container: '#dropin-container',
    vaultManager: true,
    dataCollector: true,
    paymentOptionPriority: [
      'card',
      'paypal',
      'paypalCredit',
      'venmo',
      'googlePay',
      'applePay',
    ],
    // Checkout with Vault so PayPal can be reused; Pay Later is separate
    paypal: {
      flow: 'checkout',
      amount,
      currency: 'USD',
      requestBillingAgreement: true,
    },
    paypalCredit: {
      flow: 'checkout',
      amount,
      currency: 'USD',
    },
    venmo: {
      allowDesktop: true,
    },
    googlePay: {
      googlePayVersion: 2,
      transactionInfo: {
        totalPriceStatus: 'FINAL',
        totalPrice: amount,
        currencyCode: 'USD',
      },
      allowedPaymentMethods: [
        {
          type: 'CARD',
          parameters: {
            allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
            allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'],
          },
        },
      ],
    },
    applePay: {
      displayName: 'Braintree Sample Store',
      paymentRequest: {
        total: {
          label: 'Braintree Sample Store',
          amount,
        },
        requiredBillingContactFields: ['postalAddress'],
      },
    },
  };
}

async function initializeDropin(customerId) {
  await teardownDropin();

  const amount = currentAmount();
  const tokenUrl = `/client_token?customerId=${encodeURIComponent(customerId)}`;
  const tokenRes = await fetch(tokenUrl);
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.clientToken) {
    throw new Error(tokenData.error || 'Failed to get client token');
  }

  dropinInstance = await braintree.dropin.create(
    buildDropinOptions(tokenData.clientToken, amount),
  );

  if (dropinInstance.isPaymentMethodRequestable()) {
    els.submitButton.disabled = false;
  }

  dropinInstance.on('paymentMethodRequestable', () => {
    els.submitButton.disabled = false;
  });

  dropinInstance.on('noPaymentMethodRequestable', () => {
    els.submitButton.disabled = true;
  });

  console.log('Drop-in ready for customer', customerId);
}

function syncDropinAmounts() {
  if (!dropinInstance || !dropinInstance.updateConfiguration) return;
  const amount = currentAmount();
  try {
    dropinInstance.updateConfiguration('paypal', 'amount', amount);
    dropinInstance.updateConfiguration('paypalCredit', 'amount', amount);
    dropinInstance.updateConfiguration('googlePay', {
      transactionInfo: {
        totalPriceStatus: 'FINAL',
        totalPrice: amount,
        currencyCode: 'USD',
      },
    });
    dropinInstance.updateConfiguration('applePay', {
      paymentRequest: {
        total: {
          label: 'Braintree Sample Store',
          amount,
        },
        requiredBillingContactFields: ['postalAddress'],
      },
    });
  } catch (error) {
    console.warn('Could not update Drop-in amounts:', error);
  }
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
        ? `Guest customer created (${customer.id}). Loading Drop-in…`
        : `Customer found (${customer.id}). Loading vaulted methods…`,
      'ok',
    );

    await initializeDropin(customer.id);

    els.stepCheckout.hidden = false;
    setStatus(
      els.identityStatus,
      mode === 'returning'
        ? 'Returning payer ready — select a saved method or add a new one (including Pay Later).'
        : 'Guest ready — pay with any method; it will be vaulted to this customer.',
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

els.amount.addEventListener('input', syncDropinAmounts);

els.submitButton.addEventListener('click', async () => {
  if (!dropinInstance || !activeCustomer) {
    showResult('Complete step 1 and initialize Drop-in first.', 'error');
    return;
  }

  const amount = currentAmount();
  if (parseFloat(amount) <= 0) {
    showResult('Enter a valid amount.', 'error');
    return;
  }

  hideResult();
  els.submitButton.disabled = true;
  els.submitButton.classList.add('is-loading');

  try {
    const payload = await dropinInstance.requestPaymentMethod();
    console.log('Drop-in payload:', payload);

    const response = await fetch('/api/sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethodNonce: payload.nonce,
        amount,
        customerId: activeCustomer.id,
        vault: true,
        deviceData: payload.deviceData || null,
        customer: {
          email: activeCustomer.email,
          firstName: activeCustomer.firstName,
          lastName: activeCustomer.lastName,
        },
        options: {
          storeInVault: true,
          storeInVaultOnSuccess: true,
        },
      }),
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
    message += `Instrument: ${txn.paymentInstrumentType || payload.type}\n`;
    message += `Customer ID: ${customerId}\n`;

    if (vault?.token) {
      message += `\nVaulted token: ${vault.token}`;
      if (vault.paymentType) message += ` (${vault.paymentType})`;
      if (vault.maskedNumber) message += `\nCard: ${vault.maskedNumber}`;
      if (vault.email) message += `\nPayPal: ${vault.email}`;
      if (vault.username) message += `\nVenmo: @${vault.username}`;
    } else {
      message += `\n\nNote: Drop-in may have already vaulted this method to the customer via the client token. Refresh returning checkout to confirm.`;
    }

    message += `\n\nUse this Customer ID on Returning mode to see saved methods.`;

    showResult(message, 'success', {
      transaction: txn,
      vaultedPaymentMethod: vault,
      dropinType: payload.type,
    });

    // Refresh customer vault summary
    try {
      const refresh = await fetch(
        `/api/customer/${encodeURIComponent(customerId)}`,
      );
      const refreshData = await refresh.json();
      if (refreshData.success) {
        renderCustomerBanner(
          refreshData.customer,
          refreshData.customer.paymentMethodCount > 0 ? 'returning' : payerMode,
        );
      }
    } catch (e) {
      console.warn('Could not refresh customer:', e);
    }

    if (dropinInstance.clearSelectedPaymentMethod) {
      dropinInstance.clearSelectedPaymentMethod();
    }
  } catch (error) {
    console.error('Payment error:', error);
    if (
      error?.code === 'PAYPAL_POPUP_CLOSED' ||
      error?.message?.includes('No payment method is available')
    ) {
      showResult('Payment cancelled or no method selected.', 'info');
    } else {
      showResult(error.message || String(error), 'error');
    }
  } finally {
    els.submitButton.classList.remove('is-loading');
    if (dropinInstance?.isPaymentMethodRequestable?.()) {
      els.submitButton.disabled = false;
    }
  }
});

els.resetBtn.addEventListener('click', async () => {
  await teardownDropin();
  els.stepCheckout.hidden = true;
  activeCustomer = null;
  hideResult();
  setStatus(els.identityStatus, 'Ready for a new guest or returning payer.');
});
