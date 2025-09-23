// DOM elements
const form = document.getElementById('payment-form');
const submitButton = document.getElementById('submit-button');
const amountInput = document.getElementById('amount');
const resultDiv = document.getElementById('result');
const vaultCheckbox = document.getElementById('vault-payment-method');

let hostedFieldsInstance;
let paypalCheckoutInstance;
let venmoInstance;
let clientInstance; // Store client instance for Venmo re-initialization

// Initialize Braintree when page loads
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initializeBraintree();

    // Add event listener to the vault checkbox to re-render PayPal button when it changes
    if (vaultCheckbox) {
      vaultCheckbox.addEventListener('change', function () {
        // Re-initialize PayPal with the new vault preference
        if (clientInstance) {
          initializePayPal(clientInstance);
        }
      });
    }
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

    // Initialize PayPal (with Promise chain)
    initializePayPal(clientInstance);

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
        vaultPaymentMethod: vaultCheckbox.checked,
      }),
    });

    const result = await response.json();

    if (result.success) {
      let successMessage = `Payment successful! Transaction ID: ${result.transaction.id}. Amount: $${result.transaction.amount}`;

      // Add vaulted payment method info if available
      if (result.vaultedPaymentMethod) {
        successMessage += `<br><br><strong>Payment Method saved for future use!</strong><br>`;

        // Display appropriate details based on payment method type
        if (result.vaultedPaymentMethod.paymentType === 'PayPal') {
          successMessage += `
            Payment Type: PayPal<br>
            PayPal Email: ${result.vaultedPaymentMethod.email}<br>
            Payment Method Token: ${result.vaultedPaymentMethod.token}`;
        } else {
          successMessage += `
            Card ending in: ${result.vaultedPaymentMethod.maskedNumber.slice(
              -4
            )}<br>
            Type: ${result.vaultedPaymentMethod.cardType}<br>
            Payment Method Token: ${result.vaultedPaymentMethod.token}`;
        }

        if (result.vaultedPaymentMethod.customerId) {
          successMessage += `<br>Customer ID: ${result.vaultedPaymentMethod.customerId}`;
        }
      }

      showResult(successMessage, 'success');
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

  // No auto-hide for success messages - keeping them persistent as requested
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
function initializePayPal(clientInstance) {
  // Clear any existing PayPal button
  const paypalContainer = document.getElementById('paypal-button');
  if (paypalContainer) {
    paypalContainer.innerHTML = '';
  }

  // Create a PayPal Checkout component
  return braintree.paypalCheckout
    .create({
      client: clientInstance,
    })
    .then(function (checkoutInstance) {
      // Store the instance for later use
      paypalCheckoutInstance = checkoutInstance;

      // Load the PayPal SDK
      return paypalCheckoutInstance.loadPayPalSDK({
        currency: 'USD',
        intent: 'capture',
        commit: true, // Show the Pay Now button on PayPal review page
      });
    })
    .then(function () {
      // Create a function for the PayPal button that checks the vault checkbox state
      // This ensures we're only providing either createOrder OR createBillingAgreement, not both
      const getButtonConfig = function () {
        const config = {
          fundingSource: paypal.FUNDING.PAYPAL,

          onApprove: function (data) {
            console.log('PayPal onApprove data:', data);
            return paypalCheckoutInstance
              .tokenizePayment(data)
              .then(function (payload) {
                // Show a message that we're processing the payment
                showResult('Processing your payment...', 'info');
                console.log('PayPal tokenize payload:', payload);

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
        };

        // Add EITHER createOrder OR createBillingAgreement based on checkbox state, but NOT both
        if (vaultCheckbox.checked) {
          // For Checkout with Vault flow - process a payment and vault at the same time
          config.createOrder = function () {
            const amount = amountInput.value;
            if (!amount || parseFloat(amount) <= 0) {
              showResult('Please enter a valid amount.', 'error');
              return;
            }

            return paypalCheckoutInstance.createPayment({
              flow: 'checkout',
              amount: parseFloat(amount).toFixed(2),
              currency: 'USD',
              intent: 'capture',
              requestBillingAgreement: true, // This enables Checkout with Vault flow
              billingAgreementDetails: {
                description: 'Your payment method will be saved for future use',
              },
              useraction: 'commit', // Force PayPal to show the confirmation page
            });
          };
        } else {
          // For regular payments, use createOrder with intent=capture
          config.createOrder = function () {
            const amount = amountInput.value;
            if (!amount || parseFloat(amount) <= 0) {
              showResult('Please enter a valid amount.', 'error');
              return;
            }

            return paypalCheckoutInstance.createPayment({
              flow: 'checkout',
              amount: parseFloat(amount).toFixed(2),
              currency: 'USD',
              intent: 'capture',
              useraction: 'commit', // Force PayPal to show the confirmation page
            });
          };
        }

        return config;
      };

      // Create and render the PayPal button with the appropriate configuration
      return paypal.Buttons(getButtonConfig()).render('#paypal-button');
    })
    .then(function () {
      // The PayPal button will be rendered in an html element with the ID
      // 'paypal-button'. This function will be called when the PayPal button
      // is set up and ready to be used
      console.log('PayPal initialized successfully');
    })
    .catch(function (error) {
      console.error('Error initializing PayPal:', error);
      document.getElementById('paypal-button').style.display = 'none';
    });
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

// Process payment with any payment method
async function processPayment(nonce, amount) {
  try {
    console.log('Processing payment with nonce:', nonce);
    console.log('Vault checkbox state:', vaultCheckbox.checked);

    const response = await fetch('/api/sale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentMethodNonce: nonce,
        amount: amount,
        vaultPaymentMethod: vaultCheckbox.checked,
      }),
    });

    const result = await response.json();
    console.log('Server response:', result);

    // Directly check for implicitly vaulted token in the response
    if (
      result.transaction &&
      result.transaction.paypal &&
      result.transaction.paypal.implicitlyVaultedPaymentMethodToken
    ) {
      console.log(
        'Found implicitly vaulted token on client side:',
        result.transaction.paypal.implicitlyVaultedPaymentMethodToken
      );
    }

    if (result.success) {
      let successMessage = `Payment successful! <br> Transaction ID: ${result.transaction.id} <br> Amount: $${result.transaction.amount}`;

      // Check for implicitly vaulted token and add it to the message
      if (
        result.transaction &&
        result.transaction.paypal &&
        result.transaction.paypal.implicitlyVaultedPaymentMethodToken
      ) {
        successMessage += `<br>Implicitly Vaulted Token: ${result.transaction.paypal.implicitlyVaultedPaymentMethodToken}`;
      }

      // Add vaulted payment method info if available
      if (result.vaultedPaymentMethod) {
        successMessage += `<br><br>Payment Method saved for future use!<br>`;

        // Display appropriate details based on payment method type
        if (result.vaultedPaymentMethod.paymentType === 'PayPal') {
          successMessage += `
            Payment Type: PayPal<br>
            PayPal Email: ${result.vaultedPaymentMethod.email}<br>
            Payment Method Token: ${result.vaultedPaymentMethod.token}`;
        } else {
          successMessage += `
            Card ending in: ${result.vaultedPaymentMethod.maskedNumber.slice(
              -4
            )}<br>
            Type: ${result.vaultedPaymentMethod.cardType}<br>
            Payment Method Token: ${result.vaultedPaymentMethod.token}`;
        }

        if (result.vaultedPaymentMethod.customerId) {
          successMessage += `<br>Customer ID: ${result.vaultedPaymentMethod.customerId}`;
        }
      }

      showResult(successMessage, 'success');
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
