const form = document.getElementById('payment-form');
const submitButton = document.getElementById('submit-button');
const amountInput = document.getElementById('amount');
const resultDiv = document.getElementById('result');
const threedsStatus = document.getElementById('threeds-status');
const require3dsCheckbox = document.getElementById('require-3ds');
const dataOnlyCheckbox = document.getElementById('data-only-requested');

let hostedFieldsInstance;
let threeDSecureInstance;
let clientInstance;
let dataCollectorInstance;

// Wire up test card buttons — click fills the hosted field via tokenization is not possible,
// so we copy the full number to clipboard and show a toast so the tester can paste it.
document.querySelectorAll('.card-btn[data-card]').forEach(btn => {
  btn.addEventListener('click', () => {
    const number = btn.dataset.card;
    navigator.clipboard.writeText(number).then(() => {
      showToast(`Copied ${number} — paste into the Card Number field`);
    }).catch(() => {
      showToast(`Card: ${number} — copy and paste into the Card Number field`);
    });
  });
});

// Wire up the soft-decline amount button
document.querySelectorAll('.amount-btn[data-amount]').forEach(btn => {
  btn.addEventListener('click', () => {
    amountInput.value = btn.dataset.amount;
    amountInput.dispatchEvent(new Event('input'));
    showToast(`Amount set to $${btn.dataset.amount}`);
  });
});

function showToast(msg) {
  let toast = document.getElementById('copy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'copy-toast';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: '#333', color: '#fff', padding: '10px 20px', borderRadius: '6px',
      fontSize: '13px', zIndex: '9999', transition: 'opacity 0.3s',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initializeBraintree();
  } catch (err) {
    console.error('Failed to initialize Braintree:', err);
    showResult('Failed to initialize payment system. Please refresh the page.', 'error');
  }
});

async function initializeBraintree() {
  const tokenResponse = await fetch('/client_token');
  const tokenData = await tokenResponse.json();

  if (!tokenData.clientToken) {
    throw new Error('Failed to get client token');
  }

  clientInstance = await braintree.client.create({ authorization: tokenData.clientToken });

  try {
    dataCollectorInstance = await braintree.dataCollector.create({
      client: clientInstance,
      paypal: true,
      kount: true,
    });
  } catch (err) {
    console.warn('Device data collector failed:', err);
    dataCollectorInstance = null;
  }

  threeDSecureInstance = await braintree.threeDSecure.create({
    version: 2,
    client: clientInstance,
  });

  hostedFieldsInstance = await braintree.hostedFields.create({
    client: clientInstance,
    styles: {
      input: {
        'font-size': '15px',
        'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#333',
      },
      'input.invalid': { color: '#dc3545' },
      'input.valid':   { color: '#28a745' },
    },
    fields: {
      number: {
        selector: '#card-number',
        placeholder: '4111 1111 1111 1111',
      },
      cvv: {
        selector: '#cvv',
        placeholder: '123',
      },
      expirationDate: {
        selector: '#expiration-date',
        placeholder: 'MM/YY',
      },
    },
  });

  let fieldsState = {
    number: { isValid: false },
    cvv: { isValid: false },
    expirationDate: { isValid: false },
  };

  hostedFieldsInstance.on('validityChange', event => {
    const field = event.fields[event.emittedBy];
    fieldsState[event.emittedBy] = { isValid: field.isValid };
    updateSubmitButton(fieldsState);
  });

  hostedFieldsInstance.on('empty', event => {
    fieldsState[event.emittedBy] = { isValid: false };
    updateSubmitButton(fieldsState);
  });

  amountInput.addEventListener('input', () => {
    updateSubmitButton(fieldsState);
  });

  console.log('Braintree 3DS initialized successfully');
}

function updateSubmitButton(fieldsState) {
  const allValid = Object.values(fieldsState).every(f => f.isValid);
  const amountValid = amountInput.value && parseFloat(amountInput.value) > 0;
  submitButton.disabled = !(allValid && amountValid);
}

form.addEventListener('submit', async event => {
  event.preventDefault();

  if (!hostedFieldsInstance || !threeDSecureInstance) {
    showResult('Payment system not initialized. Please refresh the page.', 'error');
    return;
  }

  const amount = amountInput.value;
  if (!amount || parseFloat(amount) <= 0) {
    showResult('Please enter a valid amount.', 'error');
    return;
  }

  setLoading(true);
  resultDiv.style.display = 'none';

  try {
    // Step 1: tokenize card via hosted fields
    const tokenizeResponse = await hostedFieldsInstance.tokenize();
    const { nonce } = tokenizeResponse;
    console.log('Tokenized nonce:', nonce);

    // Step 2: run 3DS verification on client
    showThreedsStatus('Running 3DS verification...');

    const firstName = document.getElementById('first-name').value.trim();
    const lastName  = document.getElementById('last-name').value.trim();
    const email     = document.getElementById('email').value.trim();
    const phone     = document.getElementById('phone').value.trim();
    const postalCode = document.getElementById('postal-code-input').value.trim();

    const verifyOptions = {
      nonce: nonce,
      bin: tokenizeResponse.details.bin,
      amount: parseFloat(amount).toFixed(2),
      email: email,
      billingAddress: {
        givenName: firstName,
        surname: lastName,
        phoneNumber: phone,
        postalCode: postalCode,
        countryCodeAlpha2: 'US',
      },
      additionalInformation: {
        shippingGivenName: firstName,
        shippingSurname: lastName,
      },
      onLookupComplete: (data, next) => {
        console.log('3DS lookup complete:', data);
        showThreedsStatus('Lookup complete — awaiting authentication...');
        next();
      },
    };

    if (dataOnlyCheckbox.checked) {
      verifyOptions.dataOnlyRequested = true;
    }

    let verifyResult;
    try {
      verifyResult = await threeDSecureInstance.verifyCard(verifyOptions);
    } catch (err) {
      hideThreedsStatus();
      // SDK errors (e.g. THREEDS_CARDINAL_SDK_ERROR) - still surface 3DS info
      console.error('3DS verifyCard error:', err);
      const detail = err.details && err.details.originalError
        ? JSON.stringify(err.details.originalError, null, 2)
        : err.message;
      showResult(
        `3DS verification failed: [${err.code || 'ERROR'}] ${err.message}<br><br>` +
        `<details><summary>Error detail</summary><pre>${detail}</pre></details>`,
        'error'
      );
      return;
    }

    hideThreedsStatus();
    console.log('3DS verifyCard result:', verifyResult);

    const {
      nonce: verifiedNonce,
      liabilityShifted,
      liabilityShiftPossible,
      threeDSecureInfo,
    } = verifyResult;

    // Evaluate the result before charging
    const require3DS = require3dsCheckbox.checked;

    if (require3DS && !liabilityShifted) {
      // If merchant requires successful auth and liability didn't shift, abort
      showResult(
        buildThreedsResultHTML({
          liabilityShifted,
          liabilityShiftPossible,
          threeDSecureInfo,
          transactionId: null,
          amount: null,
        }, 'warning',
        'Authentication required but liability did not shift. Transaction was NOT submitted. Enable "Require successful 3DS auth" to allow non-shifted payments.'
        ),
        'warning'
      );
      return;
    }

    // Step 3: send verified nonce to server for settlement
    showThreedsStatus('Submitting transaction...');

    const response = await fetch('/api/3ds-sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethodNonce: verifiedNonce,
        amount: amount,
        deviceData: dataCollectorInstance ? dataCollectorInstance.deviceData : null,
      }),
    });

    hideThreedsStatus();
    const saleResult = await response.json();
    console.log('Sale result:', saleResult);

    if (saleResult.success) {
      showResult(
        buildThreedsResultHTML({
          liabilityShifted,
          liabilityShiftPossible,
          threeDSecureInfo,
          transactionId: saleResult.transaction.id,
          amount: saleResult.transaction.amount,
        }, 'success', null),
        'success'
      );
    } else {
      showResult(
        buildThreedsResultHTML({
          liabilityShifted,
          liabilityShiftPossible,
          threeDSecureInfo,
          transactionId: null,
          amount: null,
        }, 'error',
        `Sale failed: ${saleResult.error}`
        ),
        'error'
      );
    }
  } catch (err) {
    hideThreedsStatus();
    console.error('Payment error:', err);

    if (err.code === 'HOSTED_FIELDS_FIELDS_INVALID') {
      showResult('Please check your card information and try again.', 'error');
    } else if (err.code === 'HOSTED_FIELDS_FIELDS_EMPTY') {
      showResult('Please fill out all card fields.', 'error');
    } else {
      showResult(`Payment error: ${err.message}`, 'error');
    }
  } finally {
    setLoading(false);
  }
});

function buildThreedsResultHTML({ liabilityShifted, liabilityShiftPossible, threeDSecureInfo, transactionId, amount }, type, extraMsg) {
  const info = threeDSecureInfo || {};

  const rows = [
    ['Transaction ID',         transactionId || '—'],
    ['Amount',                 amount ? `$${amount}` : '—'],
    ['Liability Shifted',      liabilityShifted   ? 'Yes ✓' : 'No ✗'],
    ['Liability Shift Possible', liabilityShiftPossible ? 'Yes' : 'No'],
    ['3DS Status',             info.status || '—'],
    ['ECI Flag',               info.eciFlag || '—'],
    ['3DS Version',            info.threeDSecureVersion || info.versionRequested || '—'],
    ['Directory Response',     info.directoryResponse || '—'],
    ['Authentication Response',info.authenticationResponse || '—'],
    ['CAVV',                   info.cavv ? `<span class="result-value">${info.cavv}</span>` : '—'],
    ['DS Transaction ID',      info.dsTransactionId || '—'],
    ['Enrolled',               info.enrolled || '—'],
  ];

  const tableRows = rows.map(([k, v]) =>
    `<tr><td>${k}</td><td>${v}</td></tr>`
  ).join('');

  const heading = type === 'success'
    ? 'Payment Successful'
    : type === 'warning'
    ? '3DS Warning'
    : 'Payment Failed';

  return `
    <strong>${heading}</strong>
    ${extraMsg ? `<p style="margin-top:8px">${extraMsg}</p>` : ''}
    <table>${tableRows}</table>
  `;
}

function showResult(html, type) {
  resultDiv.innerHTML = html;
  resultDiv.className = `result ${type}`;
  resultDiv.style.display = 'block';
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showThreedsStatus(msg) {
  threedsStatus.style.display = 'block';
  threedsStatus.querySelector('.status-step').innerHTML =
    `<span class="step-icon">⟳</span> ${msg}`;
}

function hideThreedsStatus() {
  threedsStatus.style.display = 'none';
}

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.classList.toggle('loading', loading);
  submitButton.querySelector('.button-text').style.display = loading ? 'none' : 'inline';
  submitButton.querySelector('.loading-spinner').style.display = loading ? 'inline' : 'none';
}
