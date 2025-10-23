const express = require('express');
const braintree = require('braintree');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configure Braintree
const gateway = new braintree.BraintreeGateway({
  environment:
    process.env.BRAINTREE_ENVIRONMENT === 'production'
      ? braintree.Environment.Production
      : braintree.Environment.Sandbox,
  merchantId: process.env.BRAINTREE_MERCHANT_ID,
  publicKey: process.env.BRAINTREE_PUBLIC_KEY,
  privateKey: process.env.BRAINTREE_PRIVATE_KEY,
});

// Routes

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Apple Pay domain association file
app.get(
  '/.well-known/apple-developer-merchantid-domain-association',
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'public',
        '.well-known',
        'apple-developer-merchantid-domain-association'
      )
    );
  }
);

// Generate client token for Braintree
app.get('/client_token', async (req, res) => {
  try {
    const response = await gateway.clientToken.generate({});
    res.json({ clientToken: response.clientToken });
  } catch (error) {
    console.error('Error generating client token:', error);
    res.status(500).json({ error: 'Failed to generate client token' });
  }
});

// Process payment
app.post('/api/sale', async (req, res) => {
  const {
    paymentMethodNonce,
    amount,
    billingAddress,
    vaultPaymentMethod,
    cardholderName,
    paymentMethodType,
  } = req.body;

  if (!paymentMethodNonce) {
    return res.status(400).json({ error: 'Payment method nonce is required' });
  }

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    const transactionData = {
      amount: parseFloat(amount).toFixed(2),
      paymentMethodNonce: paymentMethodNonce,
      options: {
        submitForSettlement: true,
      },
    };

    // Add billing address if provided
    if (billingAddress) {
      transactionData.billing = billingAddress;
    }

    // Add vaulting if requested
    if (vaultPaymentMethod) {
      transactionData.options.storeInVaultOnSuccess = true;

      // Create customer data for vaulting
      let customerData = {};

      if (billingAddress) {
        customerData = {
          firstName: billingAddress.firstName || 'Customer',
          lastName: billingAddress.lastName || '',
        };
      } else {
        // Fallback for PayPal or when no billing address
        customerData = {
          firstName: 'PayPal',
          lastName: 'Customer',
        };
      }

      transactionData.customer = customerData;
    }

    console.log('Transaction data:', JSON.stringify(transactionData, null, 2));

    const result = await gateway.transaction.sale(transactionData);

    if (result.success) {
      console.log('Transaction successful:', result.transaction.id);
      console.log(
        'Full transaction result:',
        JSON.stringify(result.transaction, null, 2)
      );

      const response = {
        success: true,
        transaction: {
          id: result.transaction.id,
          status: result.transaction.status,
          amount: result.transaction.amount,
          // Include PayPal details if available
          paypal: result.transaction.paypal,
        },
      };

      // Include vault information if payment method was vaulted
      if (
        result.transaction.creditCard &&
        result.transaction.creditCard.token
      ) {
        response.vaultedPaymentMethod = {
          token: result.transaction.creditCard.token,
          maskedNumber: result.transaction.creditCard.maskedNumber,
          cardType: result.transaction.creditCard.cardType,
          customerId: result.transaction.customer
            ? result.transaction.customer.id
            : null,
        };
        console.log(
          'Payment method vaulted with token:',
          result.transaction.creditCard.token
        );
        if (result.transaction.customer) {
          console.log('Customer ID:', result.transaction.customer.id);
        }
      } else if (result.transaction.paypal && result.transaction.paypal.token) {
        // Handle vaulted PayPal accounts
        let token = result.transaction.paypal.token;

        console.log(
          'PayPal transaction details:',
          JSON.stringify(result.transaction.paypal, null, 2)
        );

        // Check for implicitly vaulted payment method (from Checkout with Vault flow)
        if (result.transaction.paypal.implicitlyVaultedPaymentMethodToken) {
          token = result.transaction.paypal.implicitlyVaultedPaymentMethodToken;
          console.log('PayPal account implicitly vaulted with token:', token);
        } else {
          console.log('No implicitly vaulted token found in the response');
        }

        response.vaultedPaymentMethod = {
          token: token,
          email: result.transaction.paypal.payerEmail,
          paymentType: 'PayPal',
          customerId: result.transaction.customer
            ? result.transaction.customer.id
            : null,
        };
        console.log('PayPal account vaulted with token:', token);
        if (result.transaction.customer) {
          console.log('Customer ID:', result.transaction.customer.id);
        }
      } else if (
        result.transaction.venmoAccount &&
        result.transaction.venmoAccount.token
      ) {
        // Handle vaulted Venmo accounts
        response.vaultedPaymentMethod = {
          token: result.transaction.venmoAccount.token,
          username: result.transaction.venmoAccount.username,
          paymentType: 'Venmo',
          customerId: result.transaction.customer
            ? result.transaction.customer.id
            : null,
        };
        console.log(
          'Venmo account vaulted with token:',
          result.transaction.venmoAccount.token
        );
        if (result.transaction.customer) {
          console.log('Customer ID:', result.transaction.customer.id);
        }
      } else if (
        result.transaction.androidPayCard &&
        result.transaction.androidPayCard.token
      ) {
        // Handle vaulted Google Pay/Android Pay accounts
        response.vaultedPaymentMethod = {
          token: result.transaction.androidPayCard.token,
          maskedNumber: result.transaction.androidPayCard.last4,
          cardType: result.transaction.androidPayCard.cardType,
          paymentType: 'Google Pay',
          customerId: result.transaction.customer
            ? result.transaction.customer.id
            : null,
        };
        console.log(
          'Google Pay account vaulted with token:',
          result.transaction.androidPayCard.token
        );
        if (result.transaction.customer) {
          console.log('Customer ID:', result.transaction.customer.id);
        }
      }

      res.json(response);
    } else {
      console.error('Transaction failed:', result.message);
      res.status(400).json({
        success: false,
        error: result.message,
      });
    }
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process payment',
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(
    'Make sure to update your .env file with your Braintree credentials'
  );
});
