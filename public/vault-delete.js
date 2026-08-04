const form = document.getElementById('vault-delete-form');
const deleteTypeSelect = document.getElementById('delete-type');
const recordIdInput = document.getElementById('record-id');
const recordIdLabel = document.getElementById('record-id-label');
const recordIdHelp = document.getElementById('record-id-help');
const submitButton = document.getElementById('submit-button');
const resultDiv = document.getElementById('result');
const apiLogs = document.getElementById('api-logs');
const clearLogsButton = document.getElementById('clear-logs');

const logEntries = [];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateInputCopy() {
  const isCustomer = deleteTypeSelect.value === 'customer';

  recordIdLabel.textContent = isCustomer
    ? 'Customer ID'
    : 'Payment Method Token';
  recordIdInput.placeholder = isCustomer
    ? 'e.g., a_customer_123'
    : 'e.g., token_abc123';
  recordIdHelp.textContent = isCustomer
    ? 'Enter the customer ID to delete.'
    : 'Enter the vaulted payment method token to delete.';
}

function showResult(type, title, message, details) {
  const detailBlock = details
    ? `<pre>${escapeHtml(JSON.stringify(details, null, 2))}</pre>`
    : '';

  resultDiv.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
    ${detailBlock}
  `;
  resultDiv.className = `result ${type}`;
  resultDiv.style.display = 'block';
}

function renderLogs() {
  if (logEntries.length === 0) {
    apiLogs.innerHTML =
      '<p class="empty-state">No requests yet. Submit the form to begin logging.</p>';
    return;
  }

  apiLogs.innerHTML = logEntries
    .map(entry => {
      const statusClass =
        entry.response.status >= 200 && entry.response.status < 300
          ? 'ok'
          : 'err';

      return `
        <article class="log-entry">
          <div class="log-entry-header">
            <span><strong>${escapeHtml(entry.request.method)}</strong> ${escapeHtml(entry.request.url)}</span>
            <span class="log-status ${statusClass}">HTTP ${entry.response.status}</span>
          </div>
          <div class="log-block">
            <h4>Request (${escapeHtml(entry.timestamp)})</h4>
            <pre>${escapeHtml(JSON.stringify(entry.request.body, null, 2))}</pre>
          </div>
          <div class="log-block">
            <h4>Response</h4>
            <pre>${escapeHtml(JSON.stringify(entry.response.body, null, 2))}</pre>
          </div>
        </article>
      `;
    })
    .join('');
}

function appendLog(entry) {
  logEntries.unshift(entry);
  renderLogs();
}

async function deleteVaultRecord(deleteType, id) {
  const url = '/api/vault/delete';
  const requestBody = {
    deleteType,
    id,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  let responseBody;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = {
      success: false,
      error: 'Response was not valid JSON',
    };
  }

  appendLog({
    timestamp: new Date().toLocaleString(),
    request: {
      method: 'POST',
      url,
      body: requestBody,
    },
    response: {
      status: response.status,
      body: responseBody,
    },
  });

  return {
    ok: response.ok,
    status: response.status,
    body: responseBody,
  };
}

form.addEventListener('submit', async event => {
  event.preventDefault();

  const deleteType = deleteTypeSelect.value;
  const id = recordIdInput.value.trim();

  if (!id) {
    showResult('error', 'Validation Error', 'Please enter an ID to delete.');
    return;
  }

  if (deleteType === 'customer') {
    const confirmed = window.confirm(
      `Delete customer '${id}'? This will also remove all associated vaulted payment methods.`,
    );

    if (!confirmed) {
      return;
    }
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Deleting...';

  try {
    const result = await deleteVaultRecord(deleteType, id);

    if (result.ok && result.body.success) {
      showResult(
        'success',
        'Delete Successful',
        `${deleteType === 'customer' ? 'Customer' : 'Payment method'} '${id}' was deleted from the vault.`,
        result.body,
      );
      recordIdInput.value = '';
      recordIdInput.focus();
      return;
    }

    showResult(
      'error',
      'Delete Failed',
      result.body.error || `Delete request failed with HTTP ${result.status}.`,
      result.body,
    );
  } catch (error) {
    const fallbackBody = {
      success: false,
      error: error.message || 'Unknown network error',
    };

    appendLog({
      timestamp: new Date().toLocaleString(),
      request: {
        method: 'POST',
        url: '/api/vault/delete',
        body: {
          deleteType,
          id,
        },
      },
      response: {
        status: 0,
        body: fallbackBody,
      },
    });

    showResult(
      'error',
      'Network Error',
      'Could not reach the server to complete the delete request.',
      fallbackBody,
    );
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Delete Vault Record';
  }
});

deleteTypeSelect.addEventListener('change', updateInputCopy);

clearLogsButton.addEventListener('click', () => {
  logEntries.length = 0;
  renderLogs();
});

document.addEventListener('DOMContentLoaded', () => {
  updateInputCopy();
  renderLogs();
  recordIdInput.focus();
});
