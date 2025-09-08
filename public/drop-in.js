// DOM elements
const button = document.querySelector('#submit-button');
const amountInput = document.getElementById('amount');
const resultDiv = document.getElementById('result');

// Initialize Drop-In when page loads
document.addEventListener('DOMContentLoaded', function () {
  initializeDropIn();
});

function initializeDropIn() {
  // Get client token from server
  fetch('/client_token')
    .then(response => response.json())
    .then(data => {
      if (!data.clientToken) {
        throw new Error('Failed to get client token');
      }

      // Create Drop-In instance
      braintree.dropin.create(
        {
          authorization: data.clientToken,
          container: '#dropin-container',
          vaultManager: true,
          card: {
            vault: {
              vaultCard: true,
            },
            cardholderName: {
              required: true,
            },
            billingAddress: {
              required: true,
            },
            cvv: {
              required: true,
            },
            postalCode: {
              required: true,
            },
          },
          paypal: {
            flow: 'vault',
          },
          venmo: {
            allowDesktop: true,
          },
        },
        function (createErr, instance) {
          if (createErr) {
            console.error('Error creating Drop-In:', createErr);
            showResult(
              'Error initializing payment form: ' + createErr.message,
              'error'
            );
            return;
          }

          console.log('Drop-In initialized successfully');

          // Enable submit button
          button.disabled = false;

          // Update PayPal amount when amount input changes
          amountInput.addEventListener('input', function () {
            if (instance && instance.updateConfiguration) {
              try {
                instance.updateConfiguration(
                  'paypal',
                  'amount',
                  amountInput.value
                );
              } catch (error) {
                console.warn('Could not update PayPal amount:', error);
              }
            }
          });

          // Handle button click
          button.addEventListener('click', function () {
            const amount = amountInput.value;

            if (!amount || parseFloat(amount) <= 0) {
              showResult('Please enter a valid amount.', 'error');
              return;
            }

            // Show loading state
            setLoadingState(true);

            instance.requestPaymentMethod(function (
              requestPaymentMethodErr,
              payload
            ) {
              if (requestPaymentMethodErr) {
                console.error('Payment method error:', requestPaymentMethodErr);
                setLoadingState(false);

                if (
                  requestPaymentMethodErr.code ===
                  'DROPIN_NO_PAYMENT_METHOD_SELECTED'
                ) {
                  showResult('Please select a payment method.', 'error');
                } else if (
                  requestPaymentMethodErr.code === 'VENMO_POPUP_CLOSED' ||
                  requestPaymentMethodErr.code === 'VENMO_CANCELED'
                ) {
                  showResult('Venmo payment was cancelled.', 'error');
                } else if (
                  requestPaymentMethodErr.code === 'VENMO_APP_FAILED' ||
                  requestPaymentMethodErr.message.includes('Venmo')
                ) {
                  showResult(
                    'Venmo payment failed. Please try a different payment method.',
                    'error'
                  );
                } else {
                  showResult(
                    'Payment failed: ' + requestPaymentMethodErr.message,
                    'error'
                  );
                }
                return;
              }

              // Debug: Log the payload to see what we received
              console.log('Payment method payload:', payload);

              // Only include billing address for credit card payments and only if provided by Drop-In
              let requestData = {
                paymentMethodNonce: payload.nonce,
                amount: amount,
                vaultPaymentMethod: true,
              };

              // Add billing address only for credit card payments and only if it exists in the payload
              if (
                payload.type === 'CreditCard' &&
                payload.details &&
                payload.details.billingAddress
              ) {
                requestData.billingAddress = payload.details.billingAddress;
              }

              // Send payment method nonce to server
              fetch('/api/sale', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData),
              })
                .then(response => response.json())
                .then(function (result) {
                  setLoadingState(false);

                  if (result.success) {
                    // Tear down the Drop-in UI instance
                    instance.teardown(function (teardownErr) {
                      if (teardownErr) {
                        console.error(
                          'Could not tear down Drop-in UI!',
                          teardownErr
                        );
                      } else {
                        console.info('Drop-in UI has been torn down!');
                      }
                    });

                    showResult(
                      'Payment successful! Transaction ID: ' +
                        result.transaction.id,
                      'success',
                      formatPaymentResult(result, payload.type)
                    );
                  } else {
                    console.log(result);
                    showResult(
                      'Payment failed: ' + (result.message || 'Unknown error'),
                      'error',
                      result.error
                        ? JSON.stringify(result.error, null, 2)
                        : null
                    );
                  }
                })
                .catch(function (error) {
                  setLoadingState(false);
                  console.error('Server error:', error);
                  showResult(
                    'Server error occurred. Please try again.',
                    'error'
                  );
                });
            });
          });
        }
      );
    })
    .catch(error => {
      console.error('Error getting client token:', error);
      showResult(
        'Error initializing payment system: ' + error.message,
        'error'
      );
    });
}

// Format payment result for display
function formatPaymentResult(data, paymentType) {
  const result = {
    'Transaction ID': data.transaction?.id,
    Amount: `$${data.transaction?.amount}`,
    'Payment Type': paymentType,
    Status: data.transaction?.status,
    'Processor Response': data.transaction?.processorResponseText,
    'Created At': data.transaction?.createdAt,
  };

  // Add payment-type specific information
  if (paymentType === 'PayPalAccount') {
    result['PayPal Email'] = data.transaction?.paypalDetails?.payerEmail;
    result['PayPal Payer ID'] = data.transaction?.paypalDetails?.payerId;
  } else if (paymentType === 'VenmoAccount') {
    result['Venmo Username'] = data.transaction?.venmoDetails?.username;
  } else if (paymentType === 'CreditCard') {
    result['Card Type'] = data.transaction?.creditCardDetails?.cardType;
    result['Last Four'] = data.transaction?.creditCardDetails?.last4;
  }

  return result;
}

// Show result message
function showResult(message, type, details = null) {
  resultDiv.className = `result ${type}`;
  resultDiv.style.display = 'block';

  let content = `<h4>${message}</h4>`;

  if (details) {
    if (typeof details === 'object') {
      content += '<pre>' + JSON.stringify(details, null, 2) + '</pre>';
    } else {
      content += '<pre>' + details + '</pre>';
    }
  }

  resultDiv.innerHTML = content;

  // Scroll to result
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Set loading state
function setLoadingState(isLoading) {
  if (isLoading) {
    button.disabled = true;
    const buttonText = button.querySelector('.button-text');
    const loadingSpinner = button.querySelector('.loading-spinner');

    if (buttonText) buttonText.style.display = 'none';
    if (loadingSpinner) loadingSpinner.style.display = 'flex';

    document.querySelector('.payment-form').classList.add('loading');
  } else {
    button.disabled = false;
    const buttonText = button.querySelector('.button-text');
    const loadingSpinner = button.querySelector('.loading-spinner');

    if (buttonText) buttonText.style.display = 'inline';
    if (loadingSpinner) loadingSpinner.style.display = 'none';

    document.querySelector('.payment-form').classList.remove('loading');
  }
}
