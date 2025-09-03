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
  const { paymentMethodNonce, amount } = req.body;

  if (!paymentMethodNonce) {
    return res.status(400).json({ error: 'Payment method nonce is required' });
  }

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    const result = await gateway.transaction.sale({
      amount: parseFloat(amount).toFixed(2),
      paymentMethodNonce: paymentMethodNonce,
      options: {
        submitForSettlement: true,
      },
    });

    if (result.success) {
      console.log('Transaction successful:', result.transaction.id);
      res.json({
        success: true,
        transaction: {
          id: result.transaction.id,
          status: result.transaction.status,
          amount: result.transaction.amount,
        },
      });
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
