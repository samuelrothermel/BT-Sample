(function () {
  'use strict';

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function showDebug(data) {
    const el = document.getElementById('debug-info');
    const content = document.getElementById('debug-content');
    el.style.display = 'block';
    content.textContent = JSON.stringify(data, null, 2);
  }

  function showError(elementId, message) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.style.display = 'block';
  }

  function hideError(elementId) {
    document.getElementById(elementId).style.display = 'none';
  }

  function setStep(stepNum) {
    [1, 2, 3].forEach(function (n) {
      const indicator = document.getElementById('step-' + n + '-indicator');
      if (indicator) {
        indicator.classList.remove('active', 'completed');
        if (n < stepNum) indicator.classList.add('completed');
        if (n === stepNum) indicator.classList.add('active');
      }
    });

    ['step-1', 'step-3'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    if (stepNum === 1) document.getElementById('step-1').style.display = 'block';
    if (stepNum === 3) document.getElementById('step-3').style.display = 'block';
  }

  function showResult(data) {
    const resultEl = document.getElementById('result');
    resultEl.style.display = 'block';

    if (data.success) {
      resultEl.className = 'result success';
      resultEl.innerHTML =
        '<h3>Payment Successful</h3>' +
        '<p><strong>Transaction ID:</strong> ' + data.transaction.id + '</p>' +
        '<p><strong>Status:</strong> ' + data.transaction.status + '</p>' +
        '<p><strong>Amount:</strong> $' + data.transaction.amount + '</p>' +
        '<p><strong>Payment Type:</strong> ' + (data.transaction.paymentInstrumentType || 'Crypto') + '</p>';
    } else {
      resultEl.className = 'result error';
      resultEl.innerHTML = '<h3>Payment Failed</h3><p>' + (data.error || 'Unknown error') + '</p>';
    }
  }

  // ─── URL param helpers ──────────────────────────────────────────────────────

  function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  // ─── Step 3: Process nonce returned from PayPal redirect ───────────────────

  function processReturnedNonce(nonce, amount) {
    setStep(3);
    hideError('step3-error');

    console.log('Processing returned nonce:', nonce, 'amount:', amount);

    fetch('/api/crypto-sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethodNonce: nonce, amount: amount }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        console.log('Crypto sale result:', data);
        showDebug(data);
        document.getElementById('step-3').style.display = 'none';

        if (data.success) {
          setStep(3);
          showResult(data);
        } else {
          showError('step3-error', 'Transaction failed: ' + (data.error || 'Unknown error'));
        }
      })
      .catch(function (err) {
        console.error('Error processing crypto sale:', err);
        showError('step3-error', 'Network error: ' + err.message);
      });
  }

  // ─── Step 1: Build request payload from form ────────────────────────────────

  function buildPaymentContextParams() {
    const amount = document.getElementById('amount').value;
    const merchantAccountId = document.getElementById('merchant-account-id').value.trim();
    const firstName = document.getElementById('buyer-first-name').value.trim();
    const lastName = document.getElementById('buyer-last-name').value.trim();
    const email = document.getElementById('buyer-email').value.trim();

    const baseUrl = window.location.origin;
    // Encode the amount into the return URL so we can use it after the redirect
    // without relying on sessionStorage (which may not survive cross-origin redirects)
    const returnUrl = baseUrl + '/pay-with-crypto.html?amount=' + encodeURIComponent(amount);
    const cancelUrl = baseUrl + '/pay-with-crypto.html?cancelled=true';

    return {
      amount: amount,
      currency: 'USD',
      countryCode: 'US',
      merchantAccountId: merchantAccountId || undefined,
      returnUrl: returnUrl,
      cancelUrl: cancelUrl,
      buyerDetails: {
        firstName: firstName || 'Test',
        lastName: lastName || 'Buyer',
        email: email || 'test@example.com',
      },
    };
  }

  // ─── Step 1: Initialize SDK and wire up button (Option 2 - Promise approach) ──

  function initializeCryptoPayment() {
    const startButton = document.getElementById('start-payment-button');
    const buttonText = startButton.querySelector('.button-text');
    const loadingSpinner = startButton.querySelector('.loading-spinner');

    // Initialize client + localPayment instance as a Promise
    // We hold this as a promise so the button click can chain off it
    // (Option 2 from the integration guide)
    const localPaymentInstancePromise = fetch('/client_token')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.clientToken) throw new Error('No client token received');
        return window.braintree.client.create({ authorization: data.clientToken });
      })
      .then(function (clientInstance) {
        return window.braintree.localPayment.create({ client: clientInstance });
      })
      .then(function (instance) {
        console.log('LocalPayment instance ready');
        startButton.disabled = false;
        return instance;
      })
      .catch(function (err) {
        console.error('SDK init error:', err);
        showError('step1-error',
          'Failed to initialize Braintree SDK: ' + err.message +
          '. Ensure Pay with Crypto is enabled on this merchant account.');
        showDebug({ initError: err.message });
      });

    startButton.addEventListener('click', function (event) {
      event.preventDefault();
      hideError('step1-error');

      const params = buildPaymentContextParams();

      if (!params.amount || parseFloat(params.amount) <= 0) {
        showError('step1-error', 'Please enter a valid amount.');
        return;
      }

      // Loading state
      startButton.disabled = true;
      buttonText.style.display = 'none';
      loadingSpinner.style.display = 'inline';

      // Step A: Server creates payment context via GraphQL → returns approvalUrl
      fetch('/api/crypto-payment-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
        .then(function (r) { return r.json(); })
        .then(function (serverData) {
          console.log('Payment context response:', serverData);
          showDebug(serverData);

          if (!serverData.success) {
            throw new Error(serverData.error || 'Server failed to create payment context');
          }

          if (!serverData.approvalUrl) {
            throw new Error(
              'No approvalUrl in server response. ' +
              'Check that the crypto merchant account ID is correct and crypto is enabled.'
            );
          }

          // Step B: Client SDK calls startPayment — triggers full-page redirect
          // to PayPal crypto approval UI using the approvalUrl from the server
          return localPaymentInstancePromise.then(function (localPaymentInstance) {
            if (!localPaymentInstance) {
              throw new Error('SDK not initialized — see above error.');
            }

            console.log('Calling startPayment with approvalUrl:', serverData.approvalUrl);

            return localPaymentInstance.startPayment({
              paymentType: 'crypto',
              cryptoOptions: {
                approvalUrl: serverData.approvalUrl,
              },
            });
          });
        })
        .then(function (payload) {
          // Only reached if startPayment resolves without redirecting (unexpected for crypto)
          console.log('startPayment resolved (no redirect?):', payload);
          if (payload && payload.nonce) {
            processReturnedNonce(payload.nonce, document.getElementById('amount').value);
          }
        })
        .catch(function (err) {
          console.error('Crypto payment flow error:', err);
          startButton.disabled = false;
          buttonText.style.display = 'inline';
          loadingSpinner.style.display = 'none';

          const msg = err.code ? '[SDK ' + err.code + '] ' + err.message : err.message;
          showError('step1-error', msg);
          showDebug({ error: err.message, code: err.code, type: err.type });
        });
    });
  }

  // ─── Entry point ────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('start-payment-button').disabled = true;

    // Detect return from PayPal crypto redirect
    // PayPal appends payment params on return; the nonce param name is TBD
    // — check all common names and log whatever comes back for debugging
    const params = new URLSearchParams(window.location.search);
    const cancelled = params.get('cancelled');
    const returnedAmount = params.get('amount');

    // Log all query params received on return for debugging
    if (params.toString()) {
      console.log('URL params on load:', Object.fromEntries(params.entries()));
      showDebug({ urlParamsOnReturn: Object.fromEntries(params.entries()) });
    }

    if (cancelled) {
      setStep(1);
      initializeCryptoPayment();
      showError('step1-error', 'Payment was cancelled. You can try again.');
      return;
    }

    // Check known nonce param names; the actual name from PayPal's redirect is TBD
    const returnedNonce =
      params.get('btLPToken') ||
      params.get('paymentMethodNonce') ||
      params.get('nonce') ||
      params.get('token');

    if (returnedNonce) {
      console.log('Detected return nonce:', returnedNonce, 'amount:', returnedAmount);
      processReturnedNonce(returnedNonce, returnedAmount || '10.00');
    } else {
      setStep(1);
      initializeCryptoPayment();
    }
  });

})();
