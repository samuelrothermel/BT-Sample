// DOM elements
const form = document.getElementById('ach-form');
const submitButton = document.getElementById('submit-button');
const amountInput = document.getElementById('amount');
const resultDiv = document.getElementById('result');
const vaultCheckbox = document.getElementById('vault-payment-method');

// ACH form elements
const bankRoutingNumberInput = document.getElementById('bank-routing-number');
const bankAccountNumberInput = document.getElementById('bank-account-number');
const bankAccountTypeInput = document.getElementById('bank-account-type');
const bankAccountHolderNameInput = document.getElementById(
  'bank-account-holder-name'
);

// Billing address elements
const billingStreetAddressInput = document.getElementById(
  'billing-street-address'
);
const billingCityInput = document.getElementById('billing-city');
const billingStateInput = document.getElementById('billing-state');
const billingPostalCodeInput = document.getElementById('billing-postal-code');
const billingCountryInput = document.getElementById('billing-country');

let clientInstance;
let dataCollectorInstance;
let usBankAccountInstance;

// Initialize Braintree when page loads
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initializeBraintree();

    // Set up form submission
    if (form) {
      form.addEventListener('submit', async event => {
        event.preventDefault();
        await processACHPayment();
      });
    }

    // Enable/disable submit button based on form validity
    [
      bankRoutingNumberInput,
      bankAccountNumberInput,
      bankAccountTypeInput,
      bankAccountHolderNameInput,
      billingStreetAddressInput,
      billingCityInput,
      billingStateInput,
      billingPostalCodeInput,
      amountInput,
    ].forEach(input => {
      if (input) {
        input.addEventListener('input', updateSubmitButton);
      }
    });
  } catch (error) {
    console.error('Failed to initialize Braintree:', error);
    showResult(
      'Failed to initialize payment system. Please refresh the page.',
      'error'
    );
  }
});

// Initialize Braintree Client
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

    console.log('Braintree client initialized successfully');

    // Initialize Device Data Collector for fraud prevention
    try {
      dataCollectorInstance = await braintree.dataCollector.create({
        client: clientInstance,
        paypal: false,
        kount: true,
      });
      console.log('Device data collector initialized successfully');
    } catch (error) {
      console.warn('Device data collector failed to initialize:', error);
      dataCollectorInstance = null;
    }

    // Initialize US Bank Account component
    try {
      usBankAccountInstance = await braintree.usBankAccount.create({
        client: clientInstance,
      });
      console.log('US Bank Account component initialized successfully');
    } catch (error) {
      console.error('US Bank Account component failed to initialize:', error);
      throw new Error(
        'ACH payments are not available. Please contact support.'
      );
    }
  } catch (error) {
    console.error('Braintree initialization error:', error);
    throw error;
  }
}

// Update submit button state based on form validity
function updateSubmitButton() {
  const routingNumber = bankRoutingNumberInput.value.trim();
  const accountNumber = bankAccountNumberInput.value.trim();
  const accountType = bankAccountTypeInput.value;
  const accountHolderName = bankAccountHolderNameInput.value.trim();
  const amount = amountInput.value;
  const streetAddress = billingStreetAddressInput.value.trim();
  const city = billingCityInput.value.trim();
  const state = billingStateInput.value.trim();
  const postalCode = billingPostalCodeInput.value.trim();

  const isValid =
    routingNumber.length === 9 &&
    /^\d{9}$/.test(routingNumber) &&
    accountNumber.length > 0 &&
    accountType &&
    accountHolderName.length > 0 &&
    streetAddress.length > 0 &&
    city.length > 0 &&
    state.length > 0 &&
    postalCode.length > 0 &&
    amount &&
    parseFloat(amount) > 0;

  submitButton.disabled = !isValid;
}

// Process ACH payment
async function processACHPayment() {
  const routingNumber = bankRoutingNumberInput.value.trim();
  const accountNumber = bankAccountNumberInput.value.trim();
  const accountType = bankAccountTypeInput.value;
  const accountHolderName = bankAccountHolderNameInput.value.trim();
  const amount = amountInput.value;

  // Validate ACH form
  if (
    !routingNumber ||
    !accountNumber ||
    !accountType ||
    !accountHolderName ||
    !amount
  ) {
    showResult('Please fill in all required fields.', 'error');
    return;
  }

  if (routingNumber.length !== 9 || !/^\d{9}$/.test(routingNumber)) {
    showResult('Please enter a valid 9-digit routing number.', 'error');
    return;
  }

  if (parseFloat(amount) <= 0) {
    showResult('Please enter a valid amount greater than $0.00', 'error');
    return;
  }

  // Show loading state
  setLoadingState(true);

  try {
    console.log('Tokenizing bank account...');

    // Tokenize the bank account using Braintree's US Bank Account SDK
    const tokenizePayload = {
      bankDetails: {
        routingNumber: routingNumber,
        accountNumber: accountNumber,
        accountType: accountType,
        ownershipType: 'personal',
        firstName: accountHolderName.split(' ')[0] || 'Customer',
        lastName: accountHolderName.split(' ').slice(1).join(' ') || 'User',
        billingAddress: {
          streetAddress: billingStreetAddressInput.value.trim(),
          extendedAddress: '',
          locality: billingCityInput.value.trim(),
          region: billingStateInput.value.trim(),
          postalCode: billingPostalCodeInput.value.trim(),
        },
      },
      mandateText:
        'By clicking ["Process ACH Payment"], I authorize Braintree, a service of PayPal, on behalf of ' +
        'the merchant to verify my bank account information and to debit my bank account.',
    };

    console.log('Tokenization payload:', tokenizePayload);

    const tokenizeResult = await usBankAccountInstance.tokenize(
      tokenizePayload
    );
    const nonce = tokenizeResult.nonce;

    console.log('Bank account tokenized successfully, nonce:', nonce);
    console.log('Vaulting payment method and processing ACH payment...');

    // ACH payments require vaulting before transaction
    // Send to new endpoint that handles vault + transaction
    const response = await fetch('/api/ach-sale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentMethodNonce: nonce,
        amount: amount,
        accountHolderName: accountHolderName,
        deviceData: dataCollectorInstance
          ? dataCollectorInstance.deviceData
          : null,
      }),
    });

    // Check if response is OK before parsing
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Server response error:', response.status, errorText);
      throw new Error(
        `Server error (${response.status}): ${response.statusText}. Please ensure the server is running and has been restarted to load the latest changes.`
      );
    }

    const result = await response.json();
    console.log('ACH payment response:', result);

    if (result.success) {
      let successMessage = `✅ ACH Payment Successful!<br><br>`;
      successMessage += `<strong>Transaction Details:</strong><br>`;
      successMessage += `Transaction ID: ${result.transaction.id}<br>`;
      successMessage += `Amount: $${result.transaction.amount}<br>`;
      successMessage += `Status: ${result.transaction.status
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())}`;

      // Handle US Bank Account details from Braintree response
      if (result.transaction.usBankAccount) {
        const bankAccount = result.transaction.usBankAccount;
        successMessage += `<br><br><strong>Bank Account:</strong><br>`;
        successMessage += `Account: ****${bankAccount.last4}<br>`;
        successMessage += `Type: ${bankAccount.accountType
          .charAt(0)
          .toUpperCase()}${bankAccount.accountType.slice(1)}`;

        if (bankAccount.bankName) {
          successMessage += `<br>Bank: ${bankAccount.bankName}`;
        }
        if (bankAccount.accountHolderName) {
          successMessage += `<br>Account Holder: ${bankAccount.accountHolderName}`;
        }
      }

      // ACH always vaults the payment method
      if (result.vaultedPaymentMethod) {
        successMessage += `<br><br><strong>✓ Payment Method Saved!</strong><br>`;
        successMessage += `Token: ${result.vaultedPaymentMethod.token}`;
        if (result.vaultedPaymentMethod.customerId) {
          successMessage += `<br>Customer ID: ${result.vaultedPaymentMethod.customerId}`;
        }
        successMessage += `<br><small>Your bank account is securely saved for future payments.</small>`;
      }

      successMessage += `<br><br><small><strong>Note:</strong> ACH payments typically take 3-5 business days to settle.</small>`;

      showResult(successMessage, 'success');

      // Reset form
      form.reset();
      amountInput.value = '10.00';
      updateSubmitButton();
    } else {
      showResult(`❌ Payment failed: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('ACH payment error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      details: error.details,
      stack: error.stack,
    });

    // Provide more specific error messages
    let errorMessage = '❌ Payment processing failed.<br><br>';

    if (error.code) {
      errorMessage += `<strong>Error Code:</strong> ${error.code}<br>`;
    }

    if (error.message) {
      errorMessage += `<strong>Error:</strong> ${error.message}<br>`;
    }

    if (error.details) {
      errorMessage += `<strong>Details:</strong> ${JSON.stringify(
        error.details
      )}<br>`;
    }

    if (!error.message && !error.code) {
      errorMessage +=
        'An unknown error occurred. Please check the console for details.';
    }

    showResult(errorMessage, 'error');
  } finally {
    setLoadingState(false);
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

  // Scroll result into view
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Auto-hide info messages after 5 seconds
  if (type === 'info') {
    setTimeout(() => {
      resultDiv.style.display = 'none';
    }, 5000);
  }
}

// Set loading state
function setLoadingState(loading) {
  submitButton.disabled = loading;
  const buttonText = submitButton.querySelector('.button-text');
  const spinner = submitButton.querySelector('.loading-spinner');

  if (buttonText && spinner) {
    buttonText.style.display = loading ? 'none' : 'inline';
    spinner.style.display = loading ? 'inline' : 'none';
  }
}
