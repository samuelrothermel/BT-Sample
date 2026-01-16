// DOM elements
const form = document.getElementById('payment-form');
const submitButton = document.getElementById('submit-button');
const amountInput = document.getElementById('amount');
const resultDiv = document.getElementById('result');
const customerIdInput = document.getElementById('customer-id');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history');
const insightsContent = document.getElementById('insights-content');

let hostedFieldsInstance;
let dataCollectorInstance;

// Store vault history in memory
let vaultHistory = [];

// Initialize Braintree when page loads
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initializeBraintree();
    loadHistoryFromStorage();
    updateInsights();
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
    // Get client token
    const tokenResponse = await fetch('/client_token');
    const tokenData = await tokenResponse.json();

    if (!tokenData.clientToken) {
      throw new Error('Failed to get client token');
    }

    // Create Braintree client
    const clientInstance = await braintree.client.create({
      authorization: tokenData.clientToken,
    });

    // Initialize Device Data Collector
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

    console.log('Braintree initialized successfully');
  } catch (error) {
    console.error('Braintree initialization error:', error);
    throw error;
  }
}

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

  // Get customer strategy
  const customerStrategy = document.querySelector(
    'input[name="customer-strategy"]:checked'
  ).value;
  const useExistingCustomer = customerStrategy === 'same';

  // Disable form and show loading state
  setLoading(true);

  try {
    // Tokenize the card data
    const tokenizeResponse = await hostedFieldsInstance.tokenize();
    const { nonce, details } = tokenizeResponse;

    console.log('Payment method nonce:', nonce);
    console.log('Card details:', details);

    // Determine customer ID to use
    let targetCustomerId;
    if (useExistingCustomer) {
      targetCustomerId = customerIdInput.value.trim() || null;
      // If no customer ID provided and we're using "same customer" mode,
      // use the first customer ID from history (if available)
      if (!targetCustomerId && vaultHistory.length > 0) {
        const firstSuccessfulVault = vaultHistory.find(
          item => item.success && item.customerId
        );
        if (firstSuccessfulVault) {
          targetCustomerId = firstSuccessfulVault.customerId;
          customerIdInput.value = targetCustomerId;
          console.log('Using existing customer ID:', targetCustomerId);
        }
      }
    } else {
      // Always create new customer
      targetCustomerId = null;
    }

    // Create request data
    const requestData = {
      paymentMethodNonce: nonce,
      amount: amount,
      vaultPaymentMethod: true,
      cardholderName: document.getElementById('cardholder-name').value,
      deviceData: dataCollectorInstance
        ? dataCollectorInstance.deviceData
        : null,
    };

    // Add customer ID if specified
    if (targetCustomerId) {
      requestData.existingCustomerId = targetCustomerId;
    }

    // Send payment data to server
    const response = await fetch('/api/vault-test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    const result = await response.json();

    // Record this attempt in history
    const historyItem = {
      timestamp: new Date().toISOString(),
      success: result.success,
      amount: amount,
      cardLast4: details.lastFour || 'N/A',
      cardType: details.cardType || 'N/A',
      strategy: useExistingCustomer ? 'Same Customer' : 'New Customer',
      customerId: result.customerId || targetCustomerId || 'N/A',
      paymentMethodToken: result.vaultedPaymentMethod
        ? result.vaultedPaymentMethod.token
        : 'N/A',
      transactionId: result.transaction ? result.transaction.id : 'N/A',
      error: result.error || null,
      isDuplicate: false, // Will be analyzed
    };

    // Check for duplicates
    historyItem.isDuplicate = checkForDuplicate(historyItem);

    vaultHistory.unshift(historyItem); // Add to beginning
    saveHistoryToStorage();
    updateHistoryDisplay();
    updateInsights();

    if (result.success) {
      let successMessage = `✅ Payment Method Vaulted Successfully!<br><br>`;
      successMessage += `<strong>Transaction ID:</strong> ${result.transaction.id}<br>`;
      successMessage += `<strong>Amount:</strong> $${result.transaction.amount}<br><br>`;

      if (result.vaultedPaymentMethod) {
        successMessage += `<strong>Vaulted Payment Method:</strong><br>`;
        successMessage += `Token: ${result.vaultedPaymentMethod.token}<br>`;
        successMessage += `Card: ${result.vaultedPaymentMethod.cardType} ending in ${result.vaultedPaymentMethod.maskedNumber}<br>`;
        successMessage += `Customer ID: ${result.customerId || result.vaultedPaymentMethod.customerId}<br>`;
      }

      if (historyItem.isDuplicate) {
        successMessage += `<br><span class="badge warning">⚠️ Potential Duplicate Detected</span>`;
      }

      showResult(successMessage, 'success');

      // Update customer ID field for next test
      if (useExistingCustomer && result.customerId) {
        customerIdInput.value = result.customerId;
      }
    } else {
      showResult(`❌ Vaulting failed: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Payment error:', error);

    const historyItem = {
      timestamp: new Date().toISOString(),
      success: false,
      error: error.message || 'Unknown error',
      strategy: useExistingCustomer ? 'Same Customer' : 'New Customer',
    };

    vaultHistory.unshift(historyItem);
    saveHistoryToStorage();
    updateHistoryDisplay();
    updateInsights();

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

// Check if this vault attempt is a duplicate
function checkForDuplicate(newItem) {
  if (!newItem.success || !newItem.cardLast4) return false;

  // Check for same card + same customer
  const sameCustomerDuplicate = vaultHistory.some(
    item =>
      item.success &&
      item.cardLast4 === newItem.cardLast4 &&
      item.customerId === newItem.customerId &&
      item.customerId !== 'N/A' &&
      item.timestamp !== newItem.timestamp
  );

  return sameCustomerDuplicate;
}

// Update history display
function updateHistoryDisplay() {
  if (vaultHistory.length === 0) {
    historyList.innerHTML =
      '<p class="no-history">No vaulting attempts yet. Submit the form to start testing.</p>';
    return;
  }

  historyList.innerHTML = vaultHistory
    .map(item => {
      const itemClass = item.success
        ? item.isDuplicate
          ? 'history-item duplicate'
          : 'history-item'
        : 'history-item error';

      const time = new Date(item.timestamp).toLocaleString();

      return `
      <div class="${itemClass}">
        <div class="history-item-header">
          <span class="history-item-title">
            ${item.success ? '✅ Success' : '❌ Failed'}
            ${item.isDuplicate ? '<span class="badge warning">Duplicate</span>' : ''}
          </span>
          <span class="history-item-time">${time}</span>
        </div>
        ${
          item.success
            ? `
          <div class="history-item-details">
            <div class="detail-row">
              <span class="detail-label">Strategy:</span>
              <span class="detail-value">${item.strategy}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Customer ID:</span>
              <span class="detail-value">${item.customerId}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Card:</span>
              <span class="detail-value">${item.cardType} ****${item.cardLast4}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Token:</span>
              <span class="detail-value">${item.paymentMethodToken}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Transaction:</span>
              <span class="detail-value">${item.transactionId}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Amount:</span>
              <span class="detail-value">$${item.amount}</span>
            </div>
          </div>
        `
            : `
          <div class="detail-row">
            <span class="detail-label">Error:</span>
            <span class="detail-value">${item.error}</span>
          </div>
        `
        }
      </div>
    `;
    })
    .join('');
}

// Update insights section
function updateInsights() {
  const successfulVaults = vaultHistory.filter(item => item.success);

  if (successfulVaults.length === 0) {
    insightsContent.innerHTML =
      '<p class="no-data">Submit vaulting attempts to see duplicate analysis...</p>';
    return;
  }

  // Analyze data
  const uniqueCustomers = new Set(successfulVaults.map(item => item.customerId))
    .size;
  const uniqueCards = new Set(successfulVaults.map(item => item.cardLast4))
    .size;
  const totalTokens = successfulVaults.length;
  const duplicateCount = successfulVaults.filter(
    item => item.isDuplicate
  ).length;

  // Group by customer
  const customerGroups = {};
  successfulVaults.forEach(item => {
    if (!customerGroups[item.customerId]) {
      customerGroups[item.customerId] = [];
    }
    customerGroups[item.customerId].push(item);
  });

  let insightsHTML = `
    <div class="insight-card">
      <h4>📈 Summary Statistics</h4>
      <ul>
        <li><strong>Total Vault Attempts:</strong> ${vaultHistory.length} (${successfulVaults.length} successful)</li>
        <li><strong>Unique Customers:</strong> ${uniqueCustomers}</li>
        <li><strong>Unique Cards:</strong> ${uniqueCards}</li>
        <li><strong>Payment Method Tokens Created:</strong> ${totalTokens}</li>
        <li><strong>Duplicates Detected:</strong> ${duplicateCount}</li>
      </ul>
    </div>
  `;

  // Customer analysis
  insightsHTML += `
    <div class="insight-card">
      <h4>👥 Customer Analysis</h4>
  `;

  Object.keys(customerGroups).forEach(customerId => {
    const items = customerGroups[customerId];
    if (items.length > 1) {
      const cardNumbers = [...new Set(items.map(item => item.cardLast4))];
      insightsHTML += `
        <p><strong>Customer ${customerId}:</strong></p>
        <ul>
          <li>Payment Methods Vaulted: ${items.length}</li>
          <li>Unique Cards: ${cardNumbers.join(', ')}</li>
          <li>Tokens: ${items.map(i => i.paymentMethodToken).join(', ')}</li>
        </ul>
      `;
    }
  });

  insightsHTML += `</div>`;

  // Key findings
  insightsHTML += `
    <div class="insight-card">
      <h4>🔍 Key Findings</h4>
      <ul>
  `;

  if (duplicateCount > 0) {
    insightsHTML += `<li><strong>Braintree allows duplicate payment methods</strong> on the same customer - each vault creates a new token</li>`;
  }

  if (uniqueCustomers > 1 && uniqueCards === 1) {
    insightsHTML += `<li><strong>Same card across multiple customers:</strong> Each customer gets their own token for the same card</li>`;
  }

  if (totalTokens > successfulVaults.length) {
    insightsHTML += `<li><strong>Multiple tokens for same card/customer combination</strong> have been created</li>`;
  }

  insightsHTML += `
        <li><strong>Recommendation:</strong> Implement client-side checks or server-side deduplication logic to manage duplicates</li>
        <li><strong>Use Case Support:</strong> Multiple tokens for same card on one customer supports scenarios like "work card" vs "personal card" purposes</li>
      </ul>
    </div>
  `;

  insightsContent.innerHTML = insightsHTML;
}

// Clear history
clearHistoryBtn.addEventListener('click', () => {
  if (
    confirm(
      'Are you sure you want to clear all vault history? This cannot be undone.'
    )
  ) {
    vaultHistory = [];
    saveHistoryToStorage();
    updateHistoryDisplay();
    updateInsights();
    customerIdInput.value = '';
    showResult('History cleared successfully.', 'info');
  }
});

// Storage functions
function saveHistoryToStorage() {
  try {
    localStorage.setItem('vaultHistory', JSON.stringify(vaultHistory));
  } catch (error) {
    console.error('Failed to save history:', error);
  }
}

function loadHistoryFromStorage() {
  try {
    const stored = localStorage.getItem('vaultHistory');
    if (stored) {
      vaultHistory = JSON.parse(stored);
      updateHistoryDisplay();
    }
  } catch (error) {
    console.error('Failed to load history:', error);
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

  // Auto-hide info messages after 5 seconds
  if (type === 'info') {
    setTimeout(() => {
      resultDiv.style.display = 'none';
    }, 5000);
  }
}

// Set loading state
function setLoading(loading) {
  submitButton.disabled = loading;
  document.querySelector('.button-text').style.display = loading
    ? 'none'
    : 'inline';
  document.querySelector('.loading-spinner').style.display = loading
    ? 'inline'
    : 'none';
}
