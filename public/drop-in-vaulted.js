let dropinInstance;

document.addEventListener('DOMContentLoaded', function () {
  const submitButton = document.getElementById('submit-button');
  const amountInput = document.getElementById('amount');
  const dropinWrapper = document.getElementById('dropin-container');
  const result = document.getElementById('result');

  // Check if all required elements exist
  if (!submitButton || !amountInput || !dropinWrapper || !result) {
    console.error('Required DOM elements not found:', {
      submitButton: !!submitButton,
      amountInput: !!amountInput,
      dropinWrapper: !!dropinWrapper,
      result: !!result,
    });
    return;
  }

  // Function to show loading state
  function showLoading() {
    if (!submitButton) return;

    const buttonText = submitButton.querySelector('.button-text');
    const loadingSpinner = submitButton.querySelector('.loading-spinner');

    if (buttonText) buttonText.style.display = 'none';
    if (loadingSpinner) loadingSpinner.style.display = 'flex';

    submitButton.disabled = true;

    const paymentForm = document.querySelector('.payment-form');
    if (paymentForm) paymentForm.classList.add('loading');
  }

  // Function to hide loading state
  function hideLoading() {
    if (!submitButton) return;

    const buttonText = submitButton.querySelector('.button-text');
    const loadingSpinner = submitButton.querySelector('.loading-spinner');

    if (buttonText) buttonText.style.display = 'inline';
    if (loadingSpinner) loadingSpinner.style.display = 'none';

    submitButton.disabled = false;

    const paymentForm = document.querySelector('.payment-form');
    if (paymentForm) paymentForm.classList.remove('loading');
  }

  // Function to show result
  function showResult(success, message, details = null) {
    hideLoading();
    result.className = `result ${success ? 'success' : 'error'}`;

    let resultHTML = `<h4>${
      success ? '✅ Payment Successful!' : '❌ Payment Failed'
    }</h4>`;
    resultHTML += `<p>${message}</p>`;

    if (details) {
      resultHTML += `<pre>${JSON.stringify(details, null, 2)}</pre>`;
    }

    result.innerHTML = resultHTML;
    result.style.display = 'block';

    // Scroll to result
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Function to hide result
  function hideResult() {
    result.style.display = 'none';
  }

  // Get authorization from your server
  async function getClientToken() {
    try {
      const response = await fetch('/client_token');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data.clientToken;
    } catch (error) {
      console.error('Error getting client token:', error);
      showResult(
        false,
        'Failed to get client token. Please check server connection.'
      );
      throw error;
    }
  }

  // Initialize Braintree Drop-in UI with vaulting enabled
  async function initializeDropin() {
    try {
      const clientToken = await getClientToken();

      // Create the Drop-in UI instance with vaulting enabled
      dropinInstance = await braintree.dropin.create({
        authorization: clientToken,
        container: '#dropin-container',
        vaultManager: true, // Enable vault manager for automatic payment method saving
        paypal: {
          flow: 'vault', // Enable PayPal vaulting
        },
        venmo: {
          allowDesktop: true, // Allow Venmo on desktop
        },
        googlePay: {
          merchantId: 'your-merchant-id', // Replace with your actual merchant ID
          transactionInfo: {
            totalPriceStatus: 'FINAL',
            totalPrice: '10.00',
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
        card: {
          overrides: {
            fields: {
              number: {
                placeholder: '4111 1111 1111 1111',
              },
              expirationDate: {
                placeholder: 'MM/YY',
              },
              cvv: {
                placeholder: 'CVV',
              },
            },
          },
        },
      });

      console.log('Drop-in initialized successfully with vaulting enabled');
    } catch (error) {
      console.error('Error initializing Drop-in:', error);
      showResult(
        false,
        'Failed to initialize payment form. Please refresh the page and try again.'
      );
    }
  }

  // Handle form submission
  async function handleSubmit(event) {
    event.preventDefault();

    if (!dropinInstance) {
      showResult(
        false,
        'Payment form not initialized. Please refresh the page.'
      );
      return;
    }

    const amount = amountInput.value;
    if (!amount || parseFloat(amount) <= 0) {
      showResult(false, 'Please enter a valid amount greater than $0.00');
      return;
    }

    hideResult();
    showLoading();

    try {
      // Request payment method from Drop-in
      const payload = await dropinInstance.requestPaymentMethod();

      console.log('Payment method payload:', payload);

      // Send payment method to server for processing with vaulting
      const response = await fetch('/api/sale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentMethodNonce: payload.nonce,
          amount: amount,
          vault: true, // Always vault payment methods
          options: {
            storeInVault: true,
            storeInVaultOnSuccess: true,
          },
        }),
      });

      const result = await response.json();

      if (result.success) {
        let successMessage = `Payment of $${amount} processed successfully!`;

        // Add vaulting information to success message
        if (result.transaction) {
          if (result.transaction.customer && result.transaction.customer.id) {
            successMessage += `\n\n🔐 Customer created with ID: ${result.transaction.customer.id}`;
          }

          if (
            result.transaction.creditCard &&
            result.transaction.creditCard.token
          ) {
            successMessage += `\n💳 Credit card vaulted with token: ${result.transaction.creditCard.token}`;
          }

          if (
            result.transaction.paypalAccount &&
            result.transaction.paypalAccount.token
          ) {
            successMessage += `\n🅿️ PayPal account vaulted with token: ${result.transaction.paypalAccount.token}`;
          }

          if (
            result.transaction.venmoAccount &&
            result.transaction.venmoAccount.token
          ) {
            successMessage += `\n📱 Venmo account vaulted with token: ${result.transaction.venmoAccount.token}`;
          }

          if (
            result.transaction.androidPayCard &&
            result.transaction.androidPayCard.token
          ) {
            successMessage += `\n🤖 Google Pay card vaulted with token: ${result.transaction.androidPayCard.token}`;
          }

          if (
            result.transaction.applePayCard &&
            result.transaction.applePayCard.token
          ) {
            successMessage += `\n🍎 Apple Pay card vaulted with token: ${result.transaction.applePayCard.token}`;
          }

          successMessage += `\n\n✨ This payment method is now saved and can be used for future transactions!`;
        }

        showResult(true, successMessage, {
          transactionId: result.transaction.id,
          amount: result.transaction.amount,
          status: result.transaction.status,
          paymentMethod: result.transaction.paymentInstrumentType,
          vaultingInfo: {
            customerId: result.transaction.customer?.id,
            paymentMethodToken:
              result.transaction.creditCard?.token ||
              result.transaction.paypalAccount?.token ||
              result.transaction.venmoAccount?.token ||
              result.transaction.androidPayCard?.token ||
              result.transaction.applePayCard?.token,
          },
        });

        // Reset the form
        amountInput.value = '';
        if (dropinInstance) {
          dropinInstance.clearSelectedPaymentMethod();
        }
      } else {
        showResult(
          false,
          result.message || 'Payment failed. Please try again.',
          result
        );
      }
    } catch (error) {
      console.error('Payment error:', error);
      showResult(
        false,
        'An error occurred while processing your payment. Please try again.'
      );
    }
  }

  // Event listeners
  if (submitButton) {
    submitButton.addEventListener('click', handleSubmit);
  }

  // Update Google Pay amount when amount input changes
  if (amountInput) {
    amountInput.addEventListener('input', function () {
      if (dropinInstance && dropinInstance.updateConfiguration) {
        try {
          dropinInstance.updateConfiguration('googlePay', {
            transactionInfo: {
              totalPriceStatus: 'FINAL',
              totalPrice: this.value || '10.00',
              currencyCode: 'USD',
            },
          });
        } catch (error) {
          console.warn('Could not update Google Pay amount:', error);
        }
      }
    });

    // Set default amount
    amountInput.value = '10.00';
  }

  // Initialize Drop-in when page loads
  initializeDropin();
});
