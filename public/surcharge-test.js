// DOM elements
const form = document.getElementById('payment-form');
const submitButton = document.getElementById('submit-button');
const baseAmountInput = document.getElementById('base-amount');
const surchargeAmountInput = document.getElementById('surcharge-amount');
const surchargeLevelSelect = document.getElementById('surcharge-level');
const resultDiv = document.getElementById('result');

function getSurchargeMode() {
  return document.querySelector('input[name="surcharge-mode"]:checked')?.value || 'simulated';
}

// Display elements
const displayBase = document.getElementById('display-base');
const displaySurcharge = document.getElementById('display-surcharge');
const displayTotal = document.getElementById('display-total');

let hostedFieldsInstance;
let dataCollectorInstance;

// Initialize Braintree when page loads
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initializeBraintree();
    
    // Set up amount change listeners to update total display
    baseAmountInput.addEventListener('input', updateTotalDisplay);
    surchargeAmountInput.addEventListener('input', updateTotalDisplay);
    
    // Initial display update
    updateTotalDisplay();
  } catch (error) {
    console.error('Failed to initialize Braintree:', error);
    showResult(
      'Failed to initialize payment system. Please refresh the page.',
      'error'
    );
  }
});

// Update the total display when amounts change
function updateTotalDisplay() {
  const baseAmount = parseFloat(baseAmountInput.value) || 0;
  const surchargeAmount = parseFloat(surchargeAmountInput.value) || 0;
  const totalAmount = baseAmount + surchargeAmount;
  
  displayBase.textContent = `$${baseAmount.toFixed(2)}`;
  displaySurcharge.textContent = `$${surchargeAmount.toFixed(2)}`;
  displayTotal.textContent = `$${totalAmount.toFixed(2)}`;
}

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
    const clientInstance = await braintree.client.create({
      authorization: tokenData.clientToken,
    });

    // Initialize Device Data Collector for fraud prevention
    try {
      dataCollectorInstance = await braintree.dataCollector.create({
        client: clientInstance,
        paypal: true,
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

    // Enable submit button when form is valid
    hostedFieldsInstance.on('validityChange', function (event) {
      const formValid = Object.keys(event.fields).every(function (key) {
        return event.fields[key].isValid;
      });

      submitButton.disabled = !formValid;
    });

    // Handle enter key in hosted fields
    hostedFieldsInstance.on('cardTypeChange', function (event) {
      console.log('Card type changed:', event.cards[0]?.type || 'unknown');
    });

    console.log('Braintree initialized successfully');
  } catch (error) {
    console.error('Error initializing Braintree:', error);
    throw error;
  }
}

// Handle form submission
form.addEventListener('submit', async event => {
  event.preventDefault();

  const baseAmount = parseFloat(baseAmountInput.value);
  const surchargeAmount = parseFloat(surchargeAmountInput.value);
  const surchargeLevel = surchargeLevelSelect.value;
  const mode = getSurchargeMode();

  if (!baseAmount || baseAmount <= 0) {
    showResult('Please enter a valid base amount', 'error');
    return;
  }

  if (!surchargeAmount || surchargeAmount < 0) {
    showResult('Please enter a valid surcharge amount', 'error');
    return;
  }

  const totalAmount = baseAmount + surchargeAmount;

  setLoadingState(true);
  showResult(`Processing payment (${mode === 'real' ? 'real surcharge' : 'simulated surcharge'})...`, 'info');

  try {
    const { nonce } = await hostedFieldsInstance.tokenize();
    console.log('Payment method nonce:', nonce);

    const transactionData = {
      amount: totalAmount.toFixed(2),
      paymentMethodNonce: nonce,
    };

    if (mode === 'real') {
      transactionData.surcharge = {
        amount: surchargeAmount.toFixed(2),
        level: surchargeLevel,
      };
      console.log('Mode: real — sending surchargeAmount to Braintree');
    } else {
      console.log('Mode: simulated — sending total only, surcharge display-only');
    }

    if (dataCollectorInstance) {
      transactionData.deviceData = dataCollectorInstance.deviceData;
    }

    console.log('Transaction data:', transactionData);

    const response = await fetch('/api/sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transactionData),
    });

    const result = await response.json();
    console.log('Transaction result:', result);

    if (result.success) {
      const transaction = result.transaction;
      const modeLabel = mode === 'real' ? 'Real Surcharge' : 'Simulated Surcharge';
      let message = `
        <strong>✓ Payment Successful!</strong> <em>(${modeLabel})</em><br><br>
        <strong>Transaction ID:</strong> ${transaction.id}<br>
        <strong>Base Amount:</strong> $${baseAmount.toFixed(2)}<br>
        <strong>Surcharge:</strong> $${surchargeAmount.toFixed(2)} (${surchargeLevel}) ${mode === 'simulated' ? '<em>[display only]</em>' : ''}<br>
        <strong>Total Amount:</strong> $${transaction.amount}<br>
        <strong>Status:</strong> ${transaction.status}
      `;

      if (transaction.surchargeAmount) {
        message += `<br><strong>Braintree Surcharge Field:</strong> $${transaction.surchargeAmount}`;
      }

      showResult(message, 'success');
      hostedFieldsInstance.clear();
      submitButton.disabled = true;
    } else {
      showResult(`Transaction failed: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Payment processing error:', error);
    showResult(
      `Payment failed: ${error.message || 'Unknown error'}`,
      'error'
    );
  } finally {
    setLoadingState(false);
  }
});

// Set loading state for submit button
function setLoadingState(isLoading) {
  submitButton.disabled = isLoading;
  const buttonText = submitButton.querySelector('.button-text');
  const loadingSpinner = submitButton.querySelector('.loading-spinner');

  if (isLoading) {
    buttonText.style.display = 'none';
    loadingSpinner.style.display = 'inline';
  } else {
    buttonText.style.display = 'inline';
    loadingSpinner.style.display = 'none';
  }
}

// Show result message
function showResult(message, type) {
  resultDiv.innerHTML = message;
  resultDiv.className = `result ${type}`;
  resultDiv.style.display = 'block';

  // Auto-hide after 10 seconds for success messages
  if (type === 'success') {
    setTimeout(() => {
      resultDiv.style.display = 'none';
    }, 10000);
  }
}
