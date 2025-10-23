// DOM elements
const form = document.getElementById('payment-form');
const submitButton = document.getElementById('submit-button');
const amountInput = document.getElementById('amount');
const resultDiv = document.getElementById('result');

// Billing address fields
const cardholderNameInput = document.getElementById('cardholder-name');
const billingStreetAddressInput = document.getElementById(
  'billing-street-address'
);
const billingExtendedAddressInput = document.getElementById(
  'billing-extended-address'
);
const billingLocalityInput = document.getElementById('billing-locality');
const billingRegionInput = document.getElementById('billing-region');
const billingCountryInput = document.getElementById('billing-country');

let hostedFieldsInstance;
let paypalCheckoutInstance;
let venmoInstance;
let googlePaymentInstance;
let applePayInstance;
let clientInstance;

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

    // Initialize PayPal Vault Flow
    initializePayPalVault(clientInstance);

    // Initialize Venmo
    await initializeVenmo(clientInstance);

    // Initialize Google Pay
    await initializeGooglePay(clientInstance);

    // Initialize Apple Pay
    await initializeApplePay(clientInstance);

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

  // Check required billing address fields
  const requiredFieldsValid =
    cardholderNameInput.value.trim() &&
    billingStreetAddressInput.value.trim() &&
    billingLocalityInput.value.trim() &&
    billingRegionInput.value.trim() &&
    billingCountryInput.value.trim();

  submitButton.disabled = !(
    allFieldsValid &&
    amountValid &&
    requiredFieldsValid
  );
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

// Handle billing address field changes
[
  cardholderNameInput,
  billingStreetAddressInput,
  billingExtendedAddressInput,
  billingLocalityInput,
  billingRegionInput,
  billingCountryInput,
].forEach(input => {
  input.addEventListener('input', () => {
    if (hostedFieldsInstance) {
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
});

// Function to collect billing address data
function getBillingAddress() {
  return {
    firstName:
      cardholderNameInput.value.split(' ')[0] || cardholderNameInput.value,
    lastName: cardholderNameInput.value.split(' ').slice(1).join(' ') || '',
    streetAddress: billingStreetAddressInput.value.trim(),
    extendedAddress: billingExtendedAddressInput.value.trim() || undefined,
    locality: billingLocalityInput.value.trim(),
    region: billingRegionInput.value.trim(),
    postalCode: '', // This will be filled by hosted fields
    countryCodeAlpha2: billingCountryInput.value,
  };
}

// Handle form submission (Hosted Fields)
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
    console.log('Hosted Fields tokenization response:', tokenizeResponse);

    const { nonce, details } = tokenizeResponse;

    console.log('Payment method nonce:', nonce);
    console.log('Card details:', details);

    // Collect billing address
    const billingAddress = getBillingAddress();
    console.log('Billing address:', billingAddress);

    // Send payment data to server (with vault enabled)
    const response = await fetch('/api/sale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentMethodNonce: nonce,
        amount: amount,
        vaultPaymentMethod: true, // Always vault in this demo
        billingAddress: billingAddress,
        cardholderName: cardholderNameInput.value.trim(),
      }),
    });

    const result = await response.json();

    if (result.success) {
      let successMessage = `Payment successful and card saved! <br><br>`;
      successMessage += `<strong>Transaction Details:</strong><br>`;
      successMessage += `Transaction ID: ${result.transaction.id}<br>`;
      successMessage += `Amount: $${result.transaction.amount}<br><br>`;

      // Add vaulted payment method info
      if (result.vaultedPaymentMethod) {
        successMessage += `<strong>Saved Payment Method:</strong><br>`;
        successMessage += `Card ending in: ${result.vaultedPaymentMethod.maskedNumber.slice(
          -4
        )}<br>`;
        successMessage += `Card Type: ${result.vaultedPaymentMethod.cardType}<br>`;
        successMessage += `Payment Method Token: ${result.vaultedPaymentMethod.token}<br>`;

        if (result.vaultedPaymentMethod.customerId) {
          successMessage += `Customer ID: ${result.vaultedPaymentMethod.customerId}<br>`;
        }

        successMessage += `<br><em>This payment method can now be used for future payments without re-entering card details.</em>`;
      }

      showResult(successMessage, 'success');
      // Reset form but keep prefilled values
      form.reset();
      amountInput.value = '25.00';
      // Restore prefilled values
      cardholderNameInput.value = 'John Doe';
      billingStreetAddressInput.value = '123 Main St';
      billingLocalityInput.value = 'Chicago';
      billingRegionInput.value = 'IL';
      billingCountryInput.value = 'US';
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

// Initialize PayPal Vault Flow
function initializePayPalVault(clientInstance) {
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

      // Load the PayPal SDK for vault flow
      return paypalCheckoutInstance.loadPayPalSDK({
        vault: true, // Enable vault flow
        currency: 'USD',
      });
    })
    .then(function () {
      // Create PayPal button with vault flow configuration
      const buttonConfig = {
        fundingSource: paypal.FUNDING.PAYPAL,

        // Use createBillingAgreement for vault flow (NOT createOrder)
        createBillingAgreement: function () {
          console.log('Creating PayPal billing agreement...');

          return paypalCheckoutInstance.createPayment({
            flow: 'vault', // Required for vault flow
            billingAgreementDescription:
              'Secure payment method for future purchases',
            enableShippingAddress: false, // We don't need shipping for this demo
          });
        },

        onApprove: function (data) {
          console.log('PayPal vault onApprove data:', data);

          // Show processing message
          showResult(
            'Processing your PayPal vault setup and initial payment...',
            'info'
          );

          return paypalCheckoutInstance
            .tokenizePayment(data)
            .then(function (payload) {
              console.log('PayPal vault tokenize payload:', payload);

              // Process the initial payment using the vaulted PayPal method
              return processVaultedPayment(payload.nonce, amountInput.value);
            });
        },

        onCancel: function (data) {
          console.log('PayPal vault setup cancelled:', data);
          showResult('PayPal vault setup was cancelled.', 'info');
        },

        onError: function (err) {
          console.error('PayPal vault error:', err);
          showResult('PayPal vault setup failed. Please try again.', 'error');
        },
      };

      // Create and render the PayPal button
      return paypal.Buttons(buttonConfig).render('#paypal-button');
    })
    .then(function () {
      console.log('PayPal vault flow initialized successfully');
    })
    .catch(function (error) {
      console.error('Error initializing PayPal vault flow:', error);
      document.getElementById('paypal-button').innerHTML =
        '<div class="error-message">Failed to initialize PayPal. Please refresh the page.</div>';
    });
}

// Process vaulted payment
async function processVaultedPayment(
  nonce,
  amount,
  paymentMethodType = 'PayPal'
) {
  try {
    console.log('Processing vaulted payment with nonce:', nonce);
    console.log('Payment method type:', paymentMethodType);

    // Use different billing address based on payment method type
    let billingAddress;
    if (paymentMethodType === 'PayPal') {
      billingAddress = {
        firstName: 'PayPal',
        lastName: 'Customer',
        countryCodeAlpha2: 'US',
      };
    } else if (paymentMethodType === 'Venmo') {
      billingAddress = {
        firstName: 'Venmo',
        lastName: 'Customer',
        countryCodeAlpha2: 'US',
      };
    } else if (paymentMethodType === 'Google Pay') {
      billingAddress = {
        firstName: 'Google Pay',
        lastName: 'Customer',
        countryCodeAlpha2: 'US',
      };
    } else {
      // Default fallback
      billingAddress = {
        firstName: 'Alternative',
        lastName: 'Payment Customer',
        countryCodeAlpha2: 'US',
      };
    }

    const response = await fetch('/api/sale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentMethodNonce: nonce,
        amount: amount,
        vaultPaymentMethod: true, // Always vault in this demo
        billingAddress: billingAddress,
        paymentMethodType: paymentMethodType,
      }),
    });

    const result = await response.json();
    console.log('Server response:', result);

    if (result.success) {
      let successMessage = `${paymentMethodType} payment successful and payment method vaulted! <br><br>`;
      successMessage += `<strong>Transaction Details:</strong><br>`;
      successMessage += `Transaction ID: ${result.transaction.id}<br>`;
      successMessage += `Amount: $${result.transaction.amount}<br><br>`;

      // Add vaulted payment method info
      if (result.vaultedPaymentMethod) {
        successMessage += `<strong>Saved ${paymentMethodType} Payment Method:</strong><br>`;

        if (
          paymentMethodType === 'PayPal' &&
          result.vaultedPaymentMethod.email
        ) {
          successMessage += `PayPal Email: ${result.vaultedPaymentMethod.email}<br>`;
        } else if (paymentMethodType === 'Venmo') {
          successMessage += `Venmo Account: ${
            result.vaultedPaymentMethod.username || 'Linked'
          }<br>`;
        } else if (paymentMethodType === 'Google Pay') {
          successMessage += `Google Pay: Payment method linked<br>`;
        }

        successMessage += `Payment Method Token: ${result.vaultedPaymentMethod.token}<br>`;

        if (result.vaultedPaymentMethod.customerId) {
          successMessage += `Customer ID: ${result.vaultedPaymentMethod.customerId}<br>`;
        }

        successMessage += `<br><em>This ${paymentMethodType} payment method can now be used for future payments without re-authentication.</em>`;
      }

      // Check for implicitly vaulted token as well
      if (
        result.transaction &&
        result.transaction.paypal &&
        result.transaction.paypal.implicitlyVaultedPaymentMethodToken
      ) {
        successMessage += `<br><strong>Additional Info:</strong><br>`;
        successMessage += `Implicitly Vaulted Token: ${result.transaction.paypal.implicitlyVaultedPaymentMethodToken}`;
      }

      showResult(successMessage, 'success');
      // Reset amount input
      amountInput.value = '25.00';
    } else {
      showResult(
        `${paymentMethodType} payment failed: ${result.error}`,
        'error'
      );
    }
  } catch (error) {
    console.error('Vaulted payment error:', error);
    showResult(
      `${paymentMethodType} payment processing failed. Please try again.`,
      'error'
    );
  }
}

// Show result message
function showResult(message, type) {
  if (message.includes('<')) {
    resultDiv.innerHTML = message;
  } else {
    resultDiv.textContent = message;
  }
  resultDiv.className = `result ${type}`;
  resultDiv.style.display = 'block';

  // Scroll to result for better UX
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

// Initialize Venmo
async function initializeVenmo(clientInstance) {
  try {
    // For desktop, we'll use Desktop QR mode by default
    const isDesktop = !/Mobi|Android/i.test(navigator.userAgent);

    const venmoConfig = {
      client: clientInstance,
      paymentMethodUsage: 'single_use',
    };

    if (isDesktop) {
      // Desktop QR Code mode
      venmoConfig.allowDesktop = true;
      venmoConfig.allowNewBrowserTab = false;
      console.log('Initializing Venmo with Desktop QR mode');
    } else {
      // Mobile mode
      venmoConfig.allowDesktopWebLogin = true;
      venmoConfig.allowNewBrowserTab = true;
      console.log('Initializing Venmo with Mobile mode');
    }

    venmoInstance = await braintree.venmo.create(venmoConfig);

    // For desktop, we don't need to check isBrowserSupported since we're using QR mode
    if (!isDesktop && !venmoInstance.isBrowserSupported()) {
      console.log('Venmo is not supported in this mobile browser');
      document.getElementById('venmo-button').innerHTML =
        '<div class="error-message">Venmo is not supported in this browser. Please use mobile Safari or Chrome on iOS/Android.</div>';
      return;
    }

    // Create Venmo button with appropriate text for mode
    const venmoButtonContainer = document.getElementById('venmo-button');
    const buttonText = isDesktop
      ? 'Pay & Save with Venmo (QR Code)'
      : 'Pay & Save with Venmo';
    venmoButtonContainer.innerHTML = `
      <button type="button" class="venmo-button" id="venmo-pay-button">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px;">
          <path d="M15.8 2.2c1.1 1.7 1.6 3.6 1.6 5.8 0 5.1-2.8 10.7-7.9 16h-4L2.2 2.2h4.6l1.9 14.1c2.4-3.5 3.8-7 3.8-10.1 0-1.5-.3-2.9-.8-4h4.1z"/>
        </svg>
        ${buttonText}
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
          console.log('Venmo tokenize payload:', payload);
          return processVaultedPayment(payload.nonce, amount, 'Venmo');
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
            ${buttonText}
          `;
        });
    };

    console.log('Venmo initialized successfully');
  } catch (error) {
    console.error('Error initializing Venmo:', error);
    document.getElementById('venmo-button').innerHTML =
      '<div class="error-message">Venmo not available. Please try another payment method.</div>';
  }
}

// Initialize Google Pay
async function initializeGooglePay(clientInstance) {
  try {
    googlePaymentInstance = await braintree.googlePayment.create({
      client: clientInstance,
      googlePayVersion: 2,
      googleMerchantId: 'merchant-id-from-google', // This should be configured in your sandbox
    });

    const paymentsClient = new google.payments.api.PaymentsClient({
      environment: 'TEST', // Change to 'PRODUCTION' for live
    });

    // Check if Google Pay is ready with basic payment request
    const basicPaymentRequest = {
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [
        {
          type: 'CARD',
          parameters: {
            allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
            allowedCardNetworks: ['MASTERCARD', 'VISA'],
          },
        },
      ],
    };

    paymentsClient
      .isReadyToPay(basicPaymentRequest)
      .then(function (response) {
        if (response.result) {
          // Create Google Pay button
          const googlePayButton = paymentsClient.createButton({
            onClick: function () {
              const amount = amountInput.value;
              if (!amount || parseFloat(amount) <= 0) {
                showResult('Please enter a valid amount.', 'error');
                return;
              }

              // Create proper payment data request
              const paymentDataRequest =
                googlePaymentInstance.createPaymentDataRequest({
                  transactionInfo: {
                    currencyCode: 'USD',
                    totalPriceStatus: 'FINAL',
                    totalPrice: parseFloat(amount).toFixed(2),
                  },
                });

              paymentsClient
                .loadPaymentData(paymentDataRequest)
                .then(function (paymentData) {
                  console.log('Google Pay payment data:', paymentData);
                  return googlePaymentInstance.parseResponse(paymentData);
                })
                .then(function (result) {
                  console.log('Google Pay tokenize result:', result);
                  return processVaultedPayment(
                    result.nonce,
                    amount,
                    'Google Pay'
                  );
                })
                .catch(function (error) {
                  console.error('Google Pay error:', error);
                  if (error.statusCode !== 'CANCELED') {
                    showResult(
                      'Google Pay payment failed. Please try again.',
                      'error'
                    );
                  } else {
                    showResult('Google Pay payment was cancelled.', 'info');
                  }
                });
            },
          });

          document
            .getElementById('googlepay-button')
            .appendChild(googlePayButton);
          console.log('Google Pay initialized successfully');
        } else {
          console.log('Google Pay is not available');
          document.getElementById('googlepay-button').innerHTML =
            '<div class="error-message">Google Pay not available in this browser.</div>';
        }
      })
      .catch(function (error) {
        console.error('Google Pay readiness check failed:', error);
        document.getElementById('googlepay-button').innerHTML =
          '<div class="error-message">Google Pay not available.</div>';
      });
  } catch (error) {
    console.error('Error initializing Google Pay:', error);
    document.getElementById('googlepay-button').innerHTML =
      '<div class="error-message">Failed to initialize Google Pay.</div>';
  }
}

// Initialize Apple Pay
async function initializeApplePay(clientInstance) {
  try {
    // Check if Apple Pay is available
    if (!window.ApplePaySession || !ApplePaySession.canMakePayments()) {
      console.log('Apple Pay is not available');
      document.getElementById('applepay-button').innerHTML =
        '<div class="error-message">Apple Pay is not available. Please use Safari on a supported Apple device.</div>';
      return;
    }

    applePayInstance = await braintree.applePay.create({
      client: clientInstance,
    });

    // Create Apple Pay button
    const applePayButtonContainer = document.getElementById('applepay-button');
    applePayButtonContainer.innerHTML = `
      <button type="button" class="apple-pay-button-fallback" id="apple-pay-button">
        🍎 Pay with Apple Pay & Save
      </button>
    `;

    const applePayButton = document.getElementById('apple-pay-button');
    applePayButton.onclick = async function () {
      const amount = amountInput.value;
      if (!amount || parseFloat(amount) <= 0) {
        showResult('Please enter a valid amount.', 'error');
        return;
      }

      try {
        // Show loading state
        applePayButton.disabled = true;
        applePayButton.innerHTML = `
          <span style="display: inline-block; width: 16px; height: 16px; border: 2px solid #fff; border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px;"></span>
          Processing...
        `;

        // Create payment request
        const paymentRequest = applePayInstance.createPaymentRequest({
          total: {
            label: 'Vaulted Payment Demo',
            amount: parseFloat(amount).toFixed(2),
          },
          requiredBillingContactFields: ['postalAddress'],
          requiredShippingContactFields: [],
        });

        console.log('Apple Pay payment request:', paymentRequest);

        // Create Apple Pay session
        const session = new ApplePaySession(3, paymentRequest);

        session.onvalidatemerchant = function (event) {
          console.log('Apple Pay validate merchant event:', event);
          applePayInstance
            .performValidation({
              validationURL: event.validationURL,
              displayName: 'Vaulted Payment Demo',
            })
            .then(function (merchantSession) {
              session.completeMerchantValidation(merchantSession);
            })
            .catch(function (error) {
              console.error('Apple Pay merchant validation failed:', error);
              session.abort();
              showResult(
                'Apple Pay validation failed. Please try again.',
                'error'
              );
            });
        };

        session.onpaymentauthorized = function (event) {
          console.log('Apple Pay payment authorized:', event);
          applePayInstance
            .tokenize({
              token: event.payment.token,
            })
            .then(function (payload) {
              console.log('Apple Pay tokenize payload:', payload);
              session.completePayment(ApplePaySession.STATUS_SUCCESS);
              return processVaultedPayment(payload.nonce, amount, 'Apple Pay');
            })
            .catch(function (error) {
              console.error('Apple Pay tokenization failed:', error);
              session.completePayment(ApplePaySession.STATUS_FAILURE);
              showResult(
                'Apple Pay payment failed. Please try again.',
                'error'
              );
            });
        };

        session.oncancel = function () {
          console.log('Apple Pay session cancelled');
          showResult('Apple Pay payment was cancelled.', 'info');
        };

        // Begin the session
        session.begin();
      } catch (error) {
        console.error('Apple Pay error:', error);
        showResult('Apple Pay failed to start. Please try again.', 'error');
      } finally {
        // Reset button state
        applePayButton.disabled = false;
        applePayButton.innerHTML = '🍎 Pay with Apple Pay & Save';
      }
    };

    console.log('Apple Pay initialized successfully');
  } catch (error) {
    console.error('Error initializing Apple Pay:', error);
    document.getElementById('applepay-button').innerHTML =
      '<div class="error-message">Failed to initialize Apple Pay.</div>';
  }
}
