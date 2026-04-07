// DOM elements
const form = document.getElementById('subscription-form');
const submitButton = document.getElementById('submit-button');
const resultDiv = document.getElementById('result');

// Form inputs
const planIdInput = document.getElementById('plan-id');
const cardholderNameInput = document.getElementById('cardholder-name');
const firstNameInput = document.getElementById('first-name');
const lastNameInput = document.getElementById('last-name');
const streetAddressInput = document.getElementById('street-address');
const cityInput = document.getElementById('city');
const stateInput = document.getElementById('state');
const zipInput = document.getElementById('zip');

let clientInstance;
let hostedFieldsInstance;
let dataCollectorInstance;

// Initialize Braintree when page loads
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initializeBraintree();
  } catch (error) {
    console.error('Failed to initialize Braintree:', error);
    showResult(
      'Failed to initialize payment system. Please refresh the page.',
      'error',
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

    // Initialize Device Data Collector for fraud prevention
    try {
      dataCollectorInstance = await braintree.dataCollector.create({
        client: clientInstance,
        kount: true,
      });
      console.log('Device data collector initialized successfully');
    } catch (error) {
      console.warn('Device data collector failed to initialize:', error);
      dataCollectorInstance = null;
    }

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
          placeholder: '10001',
        },
      },
    });

    // Set up field event listeners
    const fieldsState = {
      number: { isValid: false },
      cvv: { isValid: false },
      expirationDate: { isValid: false },
      postalCode: { isValid: false },
    };

    hostedFieldsInstance.on('validityChange', event => {
      const field = event.fields[event.emittedBy];
      fieldsState[event.emittedBy].isValid = field.isValid;
      updateSubmitButton(fieldsState);
    });

    hostedFieldsInstance.on('empty', event => {
      fieldsState[event.emittedBy].isValid = false;
      updateSubmitButton(fieldsState);
    });

    console.log('Braintree initialized successfully for recurring billing');
  } catch (error) {
    console.error('Braintree initialization error:', error);
    throw error;
  }
}

// Update submit button state based on field validity
function updateSubmitButton(fieldsState) {
  const allFieldsValid = Object.values(fieldsState).every(
    field => field.isValid,
  );
  const planIdValid = planIdInput.value.trim().length > 0;

  submitButton.disabled = !(allFieldsValid && planIdValid);
}

// Handle plan ID input changes
planIdInput.addEventListener('input', () => {
  if (hostedFieldsInstance) {
    const fieldsState = Object.keys(
      hostedFieldsInstance.getState().fields,
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

  const planId = planIdInput.value.trim();
  if (!planId) {
    showResult('Please enter a Plan ID.', 'error');
    return;
  }

  if (!hostedFieldsInstance) {
    showResult(
      'Payment system not initialized. Please refresh the page.',
      'error',
    );
    return;
  }

  // Disable form and show loading state
  setLoading(true);

  try {
    // Step 1: Tokenize the card
    showResult('Step 1/3: Tokenizing credit card...', 'info');

    const tokenizeResponse = await hostedFieldsInstance.tokenize({
      cardholderName: cardholderNameInput.value.trim(),
      billingAddress: {
        firstName: firstNameInput.value.trim(),
        lastName: lastNameInput.value.trim(),
        streetAddress: streetAddressInput.value.trim(),
        locality: cityInput.value.trim(),
        region: stateInput.value.trim(),
        postalCode: zipInput.value.trim(),
      },
    });

    const paymentMethodNonce = tokenizeResponse.nonce;
    console.log('Card tokenized, nonce:', paymentMethodNonce);
    console.log('Card details:', tokenizeResponse.details);

    // Step 2: Vault the payment method
    showResult('Step 2/3: Vaulting payment method...', 'info');

    const firstName = firstNameInput.value.trim() || 'Customer';
    const lastName = lastNameInput.value.trim() || 'Account';

    const vaultResponse = await fetch('/api/vault-payment-method', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentMethodNonce: paymentMethodNonce,
        firstName: firstName,
        lastName: lastName,
        deviceData: dataCollectorInstance
          ? dataCollectorInstance.deviceData
          : null,
      }),
    });

    const vaultResult = await vaultResponse.json();

    if (!vaultResult.success) {
      throw new Error(vaultResult.error || 'Failed to vault payment method');
    }

    const paymentMethodToken = vaultResult.paymentMethodToken;
    const customerId = vaultResult.customerId;

    console.log('Payment method vaulted:', paymentMethodToken);
    console.log('Customer ID:', customerId);

    // Step 3: Create subscription
    showResult('Step 3/3: Creating subscription...', 'info');

    const subscriptionResponse = await fetch('/api/create-subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentMethodToken: paymentMethodToken,
        planId: planId,
      }),
    });

    const subscriptionResult = await subscriptionResponse.json();

    // Log full response for debugging
    console.log(
      'Subscription API Response Status:',
      subscriptionResponse.status,
    );
    console.log('Subscription API Response:', subscriptionResult);

    if (subscriptionResult.success) {
      let successMessage = `
        <strong>✓ Subscription Created Successfully!</strong><br><br>
        <strong>Subscription Details:</strong><br>
        Subscription ID: ${subscriptionResult.subscription.id}<br>
        Status: ${subscriptionResult.subscription.status}<br>
        Plan ID: ${subscriptionResult.subscription.planId}<br>
        Price: $${subscriptionResult.subscription.price}<br>
        ${subscriptionResult.subscription.firstBillingDate ? `First Billing Date: ${new Date(subscriptionResult.subscription.firstBillingDate).toLocaleDateString()}<br>` : ''}
        ${subscriptionResult.subscription.nextBillingDate ? `Next Billing Date: ${new Date(subscriptionResult.subscription.nextBillingDate).toLocaleDateString()}<br>` : ''}
        <br>
        <strong>Payment Method:</strong><br>
        Token: ${paymentMethodToken}<br>
        Type: Credit Card<br>
        Card: ${vaultResult.maskedNumber || tokenizeResponse.details.lastFour}<br>
        Card Type: ${vaultResult.cardType || tokenizeResponse.details.cardType}<br>
        <br>
        <strong>Customer:</strong><br>
        Customer ID: ${customerId}
      `;

      showResult(successMessage, 'success');
      // Reset form
      form.reset();
      hostedFieldsInstance.clear();
      submitButton.disabled = true;
    } else {
      console.error(
        'Subscription creation failed on server:',
        subscriptionResult,
      );

      // Build detailed error message with all debugging info
      let debugInfo = '<br><br><strong>Debug Information:</strong><br>';
      if (subscriptionResult.requestId) {
        debugInfo += `Request ID: ${subscriptionResult.requestId}<br>`;
      }
      if (subscriptionResult.errorDetails) {
        if (subscriptionResult.errorDetails.code) {
          debugInfo += `Error Code: ${subscriptionResult.errorDetails.code}<br>`;
        }
        if (subscriptionResult.errorDetails.type) {
          debugInfo += `Error Type: ${subscriptionResult.errorDetails.type}<br>`;
        }
        if (subscriptionResult.errorDetails.deepErrors) {
          debugInfo += `<br><strong>Detailed Errors:</strong><br>`;
          subscriptionResult.errorDetails.deepErrors.forEach(err => {
            debugInfo += `- ${err.message} (code: ${err.code})<br>`;
          });
        }
      }
      debugInfo += `Payment Method Token: ${paymentMethodToken}<br>`;
      debugInfo += `Plan ID: ${planId}<br>`;
      if (subscriptionResult.timestamp) {
        debugInfo += `Timestamp: ${subscriptionResult.timestamp}<br>`;
      }

      const errorWithDebug =
        (subscriptionResult.error || 'Failed to create subscription') +
        debugInfo;
      throw new Error(errorWithDebug);
    }
  } catch (error) {
    console.error('Subscription creation error:', error);

    // Provide more helpful error messages
    let errorMessage = error.message;

    // Check for common errors
    if (
      errorMessage.includes('Plan ID is invalid') ||
      errorMessage.includes('Plan') ||
      errorMessage.includes('plan')
    ) {
      errorMessage = `Plan ID Error: "${planId}" is not a valid plan in your Braintree account. Please create a plan in your Braintree Control Panel (Settings → Plans) and use that Plan ID.<br><br>Original Error: ${error.message}`;
    } else if (error.code === 'HOSTED_FIELDS_FIELDS_INVALID') {
      errorMessage =
        'Please check your card information and try again.<br><br>' +
        error.message;
    } else if (error.code === 'HOSTED_FIELDS_FIELDS_EMPTY') {
      errorMessage =
        'Please fill out all required card fields.<br><br>' + error.message;
    }

    showResult(`Failed to create subscription: ${errorMessage}`, 'error');
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

  // Scroll to result
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Set loading state
function setLoading(loading) {
  submitButton.disabled = loading;
  document.querySelector('.button-text').style.display = loading
    ? 'none'
    : 'inline';
  document.querySelector('.loading-spinner').style.display = loading
    ? 'inline-block'
    : 'none';
}
