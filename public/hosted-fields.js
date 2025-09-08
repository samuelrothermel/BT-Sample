// DOM elements
const form = document.getElementById('payment-form');
const submitButton = document.getElementById('submit-button');
const amountInput = document.getElementById('amount');
const resultDiv = document.getElementById('result');

let hostedFieldsInstance;
let paypalCheckoutInstance;
let venmoInstance;
let clientInstance; // Store client instance for Venmo re-initialization

// Initialize Braintree when page loads
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initializeBraintree();
  } catch (error) {
    console.error('Failed to initialize Braintree:', error);
    showResult(
      'Failed to initialize payment system. Please refresh the page.',
      'error'
    );
  }
});

// Initialize Braintree Client and Hosted Fields
async function initializeBraintree() {
  try {
    // Get client token from server
    const tokenResponse = await fetch('/client_token');
    const tokenData = await tokenResponse.json();

    if (!tokenData.clientToken) {
      throw new Error('Failed to get client token');
    }

    // Create Braintree client
    clientInstance = await braintree.client.create({
      authorization: tokenData.clientToken,
    });

    // Create Hosted Fields
    hostedFieldsInstance = await braintree.hostedFields.create({
      client: clientInstance,
      styles: {
        input: {
          'font-size': '16px',
          'font-family':
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
          color: '#333',
        },
        'input.invalid': {
          color: '#dc3545',
        },
        'input.valid': {
          color: '#28a745',
        },
        ':focus': {
          color: '#333',
        },
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
        postalCode: {
          selector: '#postal-code',
          placeholder: '12345',
        },
      },
    });

    // Set up event listeners for Hosted Fields
    setupHostedFieldsListeners();

    // Initialize PayPal
    await initializePayPal(clientInstance);

    // Initialize Venmo (default to web login mode)
    await initializeVenmo(clientInstance, false);

    // Set up Venmo toggle listener
    setupVenmoToggle();

    console.log('Braintree initialized successfully');
  } catch (error) {
    console.error('Error initializing Braintree:', error);
    throw error;
  }
}

// Set up event listeners for Hosted Fields
function setupHostedFieldsListeners() {
  let fieldsState = {
    number: { isValid: false },
    cvv: { isValid: false },
    expirationDate: { isValid: false },
    postalCode: { isValid: false },
  };

  // Listen for field state changes
  hostedFieldsInstance.on('validityChange', event => {
    const field = event.fields[event.emittedBy];
    fieldsState[event.emittedBy] = {
      isValid: field.isValid,
      isPotentiallyValid: field.isPotentiallyValid,
    };

    // Update submit button state
    updateSubmitButton(fieldsState);
  });

  // Listen for field focus events
  hostedFieldsInstance.on('focus', event => {
    console.log(`Field ${event.emittedBy} focused`);
  });

  // Listen for field blur events
  hostedFieldsInstance.on('blur', event => {
    console.log(`Field ${event.emittedBy} blurred`);
  });

  // Listen for empty field events
  hostedFieldsInstance.on('empty', event => {
    fieldsState[event.emittedBy].isValid = false;
    updateSubmitButton(fieldsState);
  });

  // Listen for not empty field events
  hostedFieldsInstance.on('notEmpty', event => {
    console.log(`Field ${event.emittedBy} is not empty`);
  });
}

// Update submit button state based on field validity
function updateSubmitButton(fieldsState) {
  const allFieldsValid = Object.values(fieldsState).every(
    field => field.isValid
  );
  const amountValid = amountInput.value && parseFloat(amountInput.value) > 0;

  submitButton.disabled = !(allFieldsValid && amountValid);
}

// Handle amount input changes
amountInput.addEventListener('input', () => {
  // Trigger validation check
  if (hostedFieldsInstance) {
    // Get current fields state and update button
    const fieldsState = Object.keys(
      hostedFieldsInstance.getState().fields
    ).reduce((state, fieldName) => {
      const field = hostedFieldsInstance.getState().fields[fieldName];
      state[fieldName] = { isValid: field.isValid };
      return state;
    }, {});
    updateSubmitButton(fieldsState);
  }
});

// Handle form submission
form.addEventListener('submit', async event => {
  event.preventDefault();

  if (!hostedFieldsInstance) {
    showResult(
      'Payment system not initialized. Please refresh the page.',
      'error'
    );
    return;
  }

  const amount = amountInput.value;
  if (!amount || parseFloat(amount) <= 0) {
    showResult('Please enter a valid amount.', 'error');
    return;
  }

  // Disable form and show loading state
  setLoading(true);

  try {
    // Tokenize the card data
    const tokenizeResponse = await hostedFieldsInstance.tokenize();

    // Log the raw tokenization response
    console.log(tokenizeResponse);

    const { nonce, details } = tokenizeResponse;

    console.log('Payment method nonce:', nonce);
    console.log('Card details:', details);

    // Send payment data to server
    const response = await fetch('/api/sale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentMethodNonce: nonce,
        amount: amount,
      }),
    });

    const result = await response.json();

    if (result.success) {
      showResult(
        `Payment successful! Transaction ID: ${result.transaction.id}. Amount: $${result.transaction.amount}`,
        'success'
      );
      // Reset form
      form.reset();
      amountInput.value = '10.00';
    } else {
      showResult(`Payment failed: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Payment error:', error);

    if (error.code === 'HOSTED_FIELDS_FIELDS_INVALID') {
      showResult('Please check your card information and try again.', 'error');
    } else if (error.code === 'HOSTED_FIELDS_FIELDS_EMPTY') {
      showResult('Please fill out all required fields.', 'error');
    } else {
      showResult('Payment processing failed. Please try again.', 'error');
    }
  } finally {
    setLoading(false);
  }
});

// Show result message
function showResult(message, type) {
  if (message.includes('<')) {
    resultDiv.innerHTML = message;
  } else {
    resultDiv.textContent = message;
  }
  resultDiv.className = `result ${type}`;
  resultDiv.style.display = 'block';

  // Auto-hide success messages after 10 seconds
  if (type === 'success') {
    setTimeout(() => {
      resultDiv.style.display = 'none';
    }, 10000);
  }
}

// Set loading state
function setLoading(loading) {
  const paymentForm = document.querySelector('.payment-form');

  if (loading) {
    submitButton.classList.add('loading');
    submitButton.disabled = true;
    paymentForm.classList.add('loading');
    document.querySelector('.button-text').style.display = 'none';
    document.querySelector('.loading-spinner').style.display = 'inline';
  } else {
    submitButton.classList.remove('loading');
    paymentForm.classList.remove('loading');
    document.querySelector('.button-text').style.display = 'inline';
    document.querySelector('.loading-spinner').style.display = 'none';

    // Re-enable button based on form validity
    const fieldsState = Object.keys(
      hostedFieldsInstance.getState().fields
    ).reduce((state, fieldName) => {
      const field = hostedFieldsInstance.getState().fields[fieldName];
      state[fieldName] = { isValid: field.isValid };
      return state;
    }, {});
    updateSubmitButton(fieldsState);
  }
}

// Initialize PayPal
async function initializePayPal(clientInstance) {
  try {
    paypalCheckoutInstance = await braintree.paypalCheckout.create({
      client: clientInstance,
    });

    // Load PayPal's checkout.js
    await loadPayPalScript();

    // Render PayPal button
    paypal
      .Buttons({
        fundingSource: paypal.FUNDING.PAYPAL,

        createOrder: function () {
          const amount = amountInput.value;
          if (!amount || parseFloat(amount) <= 0) {
            showResult('Please enter a valid amount.', 'error');
            return;
          }

          return paypalCheckoutInstance.createPayment({
            flow: 'checkout',
            amount: parseFloat(amount).toFixed(2),
            currency: 'USD',
            intent: 'sale',
          });
        },

        onApprove: function (data) {
          return paypalCheckoutInstance
            .tokenizePayment(data)
            .then(function (payload) {
              // Send the nonce to your server
              return processPayment(payload.nonce, amountInput.value);
            });
        },

        onCancel: function (data) {
          console.log('PayPal payment cancelled:', data);
          showResult('PayPal payment was cancelled.', 'info');
        },

        onError: function (err) {
          console.error('PayPal error:', err);
          showResult('PayPal payment failed. Please try again.', 'error');
        },
      })
      .render('#paypal-button');

    console.log('PayPal initialized successfully');
  } catch (error) {
    console.error('Error initializing PayPal:', error);
    document.getElementById('paypal-button').style.display = 'none';
  }
}

// Initialize Venmo
async function initializeVenmo(clientInstance, useDesktopMode = true) {
  try {
    // Teardown existing Venmo instance if it exists
    if (venmoInstance && typeof venmoInstance.teardown === 'function') {
      await venmoInstance.teardown();
    }

    const venmoConfig = {
      client: clientInstance,
      paymentMethodUsage: 'single_use',
    };

    if (useDesktopMode) {
      // Desktop QR Code mode
      venmoConfig.allowDesktop = true;
      venmoConfig.allowNewBrowserTab = false;
    } else {
      // Desktop Web Login mode
      venmoConfig.allowDesktopWebLogin = true;
      venmoConfig.allowNewBrowserTab = true;
    }

    venmoInstance = await braintree.venmo.create(venmoConfig);

    // Check if Venmo is available
    if (!venmoInstance.isBrowserSupported()) {
      console.log('Venmo is not supported in this browser');
      document.getElementById('venmo-button').style.display = 'none';
      return;
    }

    // Create proper Venmo button with Braintree styling
    const venmoButtonContainer = document.getElementById('venmo-button');
    const modeText = useDesktopMode ? ' (QR Code)' : ' (Web Login)';
    venmoButtonContainer.innerHTML = `
      <button type="button" class="venmo-button" id="venmo-pay-button">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px;">
          <path d="M15.8 2.2c1.1 1.7 1.6 3.6 1.6 5.8 0 5.1-2.8 10.7-7.9 16h-4L2.2 2.2h4.6l1.9 14.1c2.4-3.5 3.8-7 3.8-10.1 0-1.5-.3-2.9-.8-4h4.1z"/>
        </svg>
        Pay with Venmo${modeText}
      </button>
    `;

    const venmoButton = document.getElementById('venmo-pay-button');
    venmoButton.onclick = function () {
      const amount = amountInput.value;
      if (!amount || parseFloat(amount) <= 0) {
        showResult('Please enter a valid amount.', 'error');
        return;
      }

      // Show loading state
      venmoButton.disabled = true;
      venmoButton.innerHTML = `
        <span style="display: inline-block; width: 16px; height: 16px; border: 2px solid #fff; border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px;"></span>
        Processing...
      `;

      venmoInstance
        .tokenize()
        .then(function (payload) {
          return processPayment(payload.nonce, amount);
        })
        .catch(function (error) {
          console.error('Venmo error:', error);
          if (error.code === 'VENMO_CANCELLED') {
            showResult('Venmo payment was cancelled.', 'info');
          } else {
            showResult('Venmo payment failed. Please try again.', 'error');
          }
        })
        .finally(function () {
          // Reset button state
          venmoButton.disabled = false;
          venmoButton.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px;">
              <path d="M15.8 2.2c1.1 1.7 1.6 3.6 1.6 5.8 0 5.1-2.8 10.7-7.9 16h-4L2.2 2.2h4.6l1.9 14.1c2.4-3.5 3.8-7 3.8-10.1 0-1.5-.3-2.9-.8-4h4.1z"/>
            </svg>
            Pay with Venmo${modeText}
          `;
        });
    };
    console.log('Venmo initialized successfully');
  } catch (error) {
    console.error('Error initializing Venmo:', error);
    document.getElementById('venmo-button').style.display = 'none';
  }
}

// Set up Venmo toggle functionality
function setupVenmoToggle() {
  const toggle = document.getElementById('venmo-desktop-toggle');
  if (!toggle) {
    console.error('Venmo toggle element not found');
    return;
  }

  toggle.addEventListener('change', async function () {
    const useDesktopMode = this.checked;
    console.log(
      `Switching Venmo to ${useDesktopMode ? 'Desktop QR' : 'Web Login'} mode`
    );

    try {
      // Show loading state in the container
      const venmoButtonContainer = document.getElementById('venmo-button');
      venmoButtonContainer.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; padding: 12px; background-color: #f8f9fa; border-radius: 6px; color: #666;">
          <span style="display: inline-block; width: 16px; height: 16px; border: 2px solid #666; border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px;"></span>
          Switching mode...
        </div>
      `;

      // Re-initialize Venmo with new mode
      await initializeVenmo(clientInstance, useDesktopMode);
    } catch (error) {
      console.error('Error switching Venmo mode:', error);
      showResult('Failed to switch Venmo mode. Please try again.', 'error');
    }
  });
}

// Load PayPal's checkout.js script
function loadPayPalScript() {
  return new Promise((resolve, reject) => {
    if (window.paypal) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src =
      'https://www.paypal.com/sdk/js?client-id=sandbox&currency=USD&intent=capture&disable-funding=credit,card';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Process payment with any payment method
async function processPayment(nonce, amount) {
  try {
    const response = await fetch('/api/sale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentMethodNonce: nonce,
        amount: amount,
      }),
    });

    const result = await response.json();

    if (result.success) {
      showResult(
        `Payment successful! Transaction ID: ${result.transaction.id}. Amount: $${result.transaction.amount}`,
        'success'
      );
      // Reset amount input
      amountInput.value = '10.00';
    } else {
      showResult(`Payment failed: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Payment error:', error);
    showResult('Payment processing failed. Please try again.', 'error');
  }
}
