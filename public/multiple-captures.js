// Multiple Captures Test Page
let clientToken;
let deviceData;
let authorizationId = null;
let captureCount = 0;
let totalCapturedAmount = 0;
let originalAuthAmount = 0;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', async () => {
  try {
    showLoading();

    // Get client token
    const tokenResponse = await fetch('/client_token');
    const tokenData = await tokenResponse.json();
    clientToken = tokenData.clientToken;

    // Initialize Braintree client
    const clientInstance = await braintree.client.create({
      authorization: clientToken,
    });

    // Initialize data collector for device data
    const dataCollectorInstance = await braintree.dataCollector.create({
      client: clientInstance,
      paypal: true,
      kount: true,
    });

    deviceData = dataCollectorInstance.deviceData;

    // Initialize PayPal with Pay Later
    await initializePayPal(clientInstance);

    // Setup capture button
    document
      .getElementById('captureBtn')
      .addEventListener('click', performCapture);

    hideLoading();
  } catch (error) {
    console.error('Initialization error:', error);
    showError('Failed to initialize: ' + error.message);
    hideLoading();
  }
});

async function initializePayPal(clientInstance) {
  try {
    const paypalCheckoutInstance = await braintree.paypalCheckout.create({
      client: clientInstance,
    });

    // Load PayPal SDK with Pay Later enabled
    await paypalCheckoutInstance.loadPayPalSDK({
      currency: 'USD',
      intent: 'authorize',
      commit: false, // Show Continue button since we're just authorizing
      'enable-funding': 'paylater',
    });

    // Render PayPal button with Pay Later
    await paypal
      .Buttons({
        fundingSource: paypal.FUNDING.PAYLATER,
        style: {
          color: 'gold',
        },
        createOrder: async () => {
          const authAmount = document.getElementById('authAmount').value;

          return paypalCheckoutInstance.createPayment({
            flow: 'checkout',
            amount: parseFloat(authAmount).toFixed(2),
            currency: 'USD',
            intent: 'authorize', // Important: authorize instead of sale
            enableShippingAddress: false,
          });
        },
        onApprove: async (data, actions) => {
          showLoading();

          try {
            const payload = await paypalCheckoutInstance.tokenizePayment(data);

            // Create authorization
            const authAmount = document.getElementById('authAmount').value;
            await createAuthorization(payload.nonce, authAmount);
          } catch (error) {
            console.error('PayPal approval error:', error);
            showError('Failed to process PayPal: ' + error.message);
          } finally {
            hideLoading();
          }
        },
        onCancel: data => {
          console.log('PayPal payment cancelled:', data);
          showError('Payment was cancelled');
        },
        onError: err => {
          console.error('PayPal error:', err);
          showError('PayPal error: ' + err.message);
        },
      })
      .render('#paypalButton');

    console.log('PayPal Pay Later button initialized successfully');
  } catch (error) {
    console.error('PayPal initialization error:', error);
    showError('Failed to initialize PayPal: ' + error.message);
  }
}

async function createAuthorization(nonce, amount) {
  try {
    showLoading();

    const response = await fetch('/api/authorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentMethodNonce: nonce,
        amount: parseFloat(amount).toFixed(2),
      }),
    });

    const data = await response.json();

    if (data.success) {
      authorizationId = data.transaction.id;
      originalAuthAmount = parseFloat(data.transaction.amount);

      // Display authorization details
      document.getElementById('authId').textContent = data.transaction.id;
      document.getElementById('authStatus').textContent =
        data.transaction.status;
      document.getElementById('authAmount').textContent =
        data.transaction.amount;
      document.getElementById('authType').textContent =
        data.transaction.type || 'sale';
      document.getElementById('authPaymentMethod').textContent =
        data.transaction.paymentInstrumentType || 'paypal_account';

      if (data.transaction.paypal) {
        document.getElementById('authPayerEmail').textContent =
          data.transaction.paypal.payerEmail || 'N/A';
      }

      // Show authorization result and capture section
      document.getElementById('authResult').style.display = 'block';
      document.getElementById('step2').style.display = 'block';

      // Update capture summary
      updateCaptureSummary();

      showSuccess(
        'Authorization created successfully! You can now perform captures.',
      );
    } else {
      showError('Authorization failed: ' + data.error);
    }
  } catch (error) {
    console.error('Authorization error:', error);
    showError('Failed to create authorization: ' + error.message);
  } finally {
    hideLoading();
  }
}

async function performCapture() {
  if (!authorizationId) {
    showError(
      'No authorization available. Please create an authorization first.',
    );
    return;
  }

  const captureAmount = parseFloat(
    document.getElementById('captureAmount').value,
  );

  if (!captureAmount || captureAmount <= 0) {
    showError('Please enter a valid capture amount.');
    return;
  }

  // Check if capture would exceed original authorization
  if (totalCapturedAmount + captureAmount > originalAuthAmount) {
    showError(
      `Capture amount ($${captureAmount.toFixed(2)}) would exceed remaining authorization ($${(originalAuthAmount - totalCapturedAmount).toFixed(2)})`,
    );
    return;
  }

  try {
    showLoading();
    captureCount++;

    const response = await fetch('/api/capture', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transactionId: authorizationId,
        amount: captureAmount.toFixed(2),
      }),
    });

    const data = await response.json();

    // Add capture to history
    addCaptureToHistory(captureCount, captureAmount, data);

    if (data.success) {
      totalCapturedAmount += captureAmount;
      updateCaptureSummary();

      // Clear the capture amount input
      document.getElementById('captureAmount').value = '30.00';

      showSuccess(
        `Capture #${captureCount} successful: $${captureAmount.toFixed(2)}`,
      );
    } else {
      showError(`Capture #${captureCount} failed: ${data.error}`);
    }

    // Show results section if we have multiple attempts
    if (captureCount >= 2) {
      document.getElementById('step3').style.display = 'block';
      updateFinalResults();
    }
  } catch (error) {
    console.error('Capture error:', error);
    showError('Failed to perform capture: ' + error.message);
  } finally {
    hideLoading();
  }
}

function addCaptureToHistory(number, amount, result) {
  const captureList = document.getElementById('captureList');

  const captureItem = document.createElement('div');
  captureItem.className = `capture-item ${result.success ? 'success' : 'error'}`;

  const timestamp = new Date().toLocaleTimeString();

  captureItem.innerHTML = `
    <div class="capture-item-header">
      <span class="capture-number">Capture #${number}</span>
      <span class="capture-status ${result.success ? 'success' : 'error'}">
        ${result.success ? 'Success' : 'Failed'}
      </span>
    </div>
    <div class="capture-item-details">
      <p><strong>Time:</strong> ${timestamp}</p>
      <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
      ${
        result.success
          ? `<p><strong>Transaction ID:</strong> ${result.transaction.id}</p>
           <p><strong>Status:</strong> ${result.transaction.status}</p>`
          : `<p><strong>Error:</strong> ${result.error}</p>`
      }
    </div>
  `;

  captureList.appendChild(captureItem);
}

function updateCaptureSummary() {
  document.getElementById('originalAmount').textContent =
    originalAuthAmount.toFixed(2);
  document.getElementById('totalCaptured').textContent =
    totalCapturedAmount.toFixed(2);
  document.getElementById('remainingAmount').textContent = (
    originalAuthAmount - totalCapturedAmount
  ).toFixed(2);
}

function updateFinalResults() {
  const finalResults = document.getElementById('finalResults');

  const successfulCaptures = document.querySelectorAll(
    '.capture-item.success',
  ).length;
  const failedCaptures = document.querySelectorAll(
    '.capture-item.error',
  ).length;

  let resultHtml = '<h3>Test Results</h3>';

  if (successfulCaptures > 1) {
    resultHtml += `
      <div style="background: #e8f5e9; padding: 15px; border-radius: 6px; margin: 10px 0;">
        <p style="color: #2e7d32; font-weight: bold; margin: 0;">
          ✓ SUCCESS: Multiple captures are supported!
        </p>
        <p style="margin: 10px 0 0 0;">
          ${successfulCaptures} successful capture(s) performed against the same authorization.
        </p>
      </div>
    `;
  } else if (successfulCaptures === 1 && failedCaptures > 0) {
    resultHtml += `
      <div style="background: #fff3cd; padding: 15px; border-radius: 6px; margin: 10px 0;">
        <p style="color: #856404; font-weight: bold; margin: 0;">
          ⚠ PARTIAL: Only one capture succeeded
        </p>
        <p style="margin: 10px 0 0 0;">
          First capture succeeded but subsequent captures failed. 
          This suggests Pay Later may not support multiple captures.
        </p>
      </div>
    `;
  } else if (failedCaptures > 0 && successfulCaptures === 0) {
    resultHtml += `
      <div style="background: #ffebee; padding: 15px; border-radius: 6px; margin: 10px 0;">
        <p style="color: #c62828; font-weight: bold; margin: 0;">
          ✗ FAILED: No successful captures
        </p>
        <p style="margin: 10px 0 0 0;">
          All capture attempts failed. Check the error messages above for details.
        </p>
      </div>
    `;
  }

  resultHtml += `
    <div style="margin-top: 20px;">
      <p><strong>Total Attempts:</strong> ${captureCount}</p>
      <p><strong>Successful:</strong> ${successfulCaptures}</p>
      <p><strong>Failed:</strong> ${failedCaptures}</p>
      <p><strong>Total Captured:</strong> $${totalCapturedAmount.toFixed(2)} of $${originalAuthAmount.toFixed(2)}</p>
    </div>
  `;

  finalResults.innerHTML = resultHtml;
}

// Utility functions
function showError(message) {
  const errorDiv = document.getElementById('errorMessage');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';

  setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 8000);
}

function showSuccess(message) {
  // Create temporary success message
  const successDiv = document.createElement('div');
  successDiv.className = 'result-box';
  successDiv.textContent = message;
  successDiv.style.position = 'fixed';
  successDiv.style.top = '20px';
  successDiv.style.right = '20px';
  successDiv.style.zIndex = '1001';
  successDiv.style.maxWidth = '400px';

  document.body.appendChild(successDiv);

  setTimeout(() => {
    successDiv.remove();
  }, 5000);
}

function showLoading() {
  document.getElementById('loadingIndicator').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loadingIndicator').style.display = 'none';
}
