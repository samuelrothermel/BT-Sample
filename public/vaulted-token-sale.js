// DOM elements
const form = document.getElementById('token-sale-form');
const submitButton = document.getElementById('submit-button');
const paymentMethodTokenInput = document.getElementById('payment-method-token');
const amountInput = document.getElementById('amount');
const merchantAccountIdInput = document.getElementById('merchant-account-id');
const loadingDiv = document.getElementById('loading');
const resultDiv = document.getElementById('result');

// Form submission handler
form.addEventListener('submit', async event => {
  event.preventDefault();

  const paymentMethodToken = paymentMethodTokenInput.value.trim();
  const amount = amountInput.value;
  const merchantAccountId = merchantAccountIdInput.value.trim();

  // Validation
  if (!paymentMethodToken) {
    showResult('error', 'Please enter a payment method token');
    return;
  }

  if (!amount || parseFloat(amount) <= 0) {
    showResult('error', 'Please enter a valid amount greater than $0.00');
    return;
  }

  await processTransaction(paymentMethodToken, amount, merchantAccountId);
});

// Process transaction with vaulted token
async function processTransaction(
  paymentMethodToken,
  amount,
  merchantAccountId,
) {
  showLoading();
  hideResult();

  try {
    console.log('Processing sale with vaulted token:', paymentMethodToken);

    const requestBody = {
      paymentMethodToken: paymentMethodToken,
      amount: amount,
    };

    // Add merchant account ID if provided
    if (merchantAccountId) {
      requestBody.merchantAccountId = merchantAccountId;
      console.log('Using merchant account:', merchantAccountId);
    }

    const response = await fetch('/api/sale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const result = await response.json();

    hideLoading();

    if (result.success) {
      console.log('Transaction successful:', result);
      showSuccessResult(result);
    } else {
      console.error('Transaction failed:', result);
      showResult(
        'error',
        result.error || 'Transaction failed. Please try again.',
      );
    }
  } catch (error) {
    hideLoading();
    console.error('Error processing transaction:', error);
    showResult(
      'error',
      'An error occurred while processing the transaction. Please check the console for details.',
    );
  }
}

// Show success result with transaction details
function showSuccessResult(result) {
  const transaction = result.transaction;

  let html = '<h3>✅ Transaction Successful!</h3>';
  html += '<div class="result-details">';
  html += `<div class="result-item"><strong>Transaction ID:</strong> ${transaction.id}</div>`;
  html += `<div class="result-item"><strong>Status:</strong> ${transaction.status}</div>`;
  html += `<div class="result-item"><strong>Amount:</strong> $${transaction.amount}</div>`;

  // Show payment method details if available
  if (transaction.creditCard) {
    html += '<hr style="margin: 1rem 0;">';
    html += '<h4>💳 Credit Card Details</h4>';
    html += `<div class="result-item"><strong>Card Type:</strong> ${transaction.creditCard.cardType}</div>`;
    html += `<div class="result-item"><strong>Last 4:</strong> ${transaction.creditCard.last4}</div>`;
    if (transaction.creditCard.token) {
      html += `<div class="result-item"><strong>Token:</strong> ${transaction.creditCard.token}</div>`;
    }
  } else if (transaction.usBankAccount) {
    html += '<hr style="margin: 1rem 0;">';
    html += '<h4>🏦 ACH Bank Account Details</h4>';
    html += `<div class="result-item"><strong>Bank Name:</strong> ${transaction.usBankAccount.bankName || 'N/A'}</div>`;
    html += `<div class="result-item"><strong>Account Type:</strong> ${transaction.usBankAccount.accountType || 'N/A'}</div>`;
    html += `<div class="result-item"><strong>Last 4:</strong> ${transaction.usBankAccount.last4 || 'N/A'}</div>`;
    if (transaction.usBankAccount.token) {
      html += `<div class="result-item"><strong>Token:</strong> ${transaction.usBankAccount.token}</div>`;
    }
  } else if (transaction.paypal) {
    html += '<hr style="margin: 1rem 0;">';
    html += '<h4>🅿️ PayPal Details</h4>';
    html += `<div class="result-item"><strong>Payer Email:</strong> ${transaction.paypal.payerEmail || 'N/A'}</div>`;
    if (transaction.paypal.token) {
      html += `<div class="result-item"><strong>Token:</strong> ${transaction.paypal.token}</div>`;
    }
  } else if (transaction.venmoAccount) {
    html += '<hr style="margin: 1rem 0;">';
    html += '<h4>📱 Venmo Details</h4>';
    html += `<div class="result-item"><strong>Username:</strong> ${transaction.venmoAccount.username || 'N/A'}</div>`;
    if (transaction.venmoAccount.token) {
      html += `<div class="result-item"><strong>Token:</strong> ${transaction.venmoAccount.token}</div>`;
    }
  }

  html += '</div>';

  html +=
    '<div style="margin-top: 1.5rem; padding: 1rem; background: #e7f3ff; border-radius: 4px;">';
  html += '<p style="margin: 0;"><strong>💡 Next Steps:</strong></p>';
  html +=
    '<p style="margin: 0.5rem 0 0 0;">You can use the same token to process additional transactions without re-verification.</p>';
  html += '</div>';

  resultDiv.innerHTML = html;
  resultDiv.className = 'result success';
  resultDiv.style.display = 'block';

  // Scroll to result
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Show result message
function showResult(type, message) {
  resultDiv.innerHTML = `
    <h3>${type === 'success' ? '✅ Success' : '❌ Error'}</h3>
    <p>${message}</p>
  `;
  resultDiv.className = `result ${type}`;
  resultDiv.style.display = 'block';

  // Scroll to result
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Show loading state
function showLoading() {
  loadingDiv.style.display = 'block';
  submitButton.disabled = true;
}

// Hide loading state
function hideLoading() {
  loadingDiv.style.display = 'none';
  submitButton.disabled = false;
}

// Hide result
function hideResult() {
  resultDiv.style.display = 'none';
}

// Auto-focus on token input when page loads
document.addEventListener('DOMContentLoaded', () => {
  paymentMethodTokenInput.focus();
});
