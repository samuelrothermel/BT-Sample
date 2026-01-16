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

// Serve Apple Pay domain association file
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
    const tokenConfig = {};

    // If merchant account ID is provided, include it in the token generation
    if (req.query.merchantAccountId) {
      tokenConfig.merchantAccountId = req.query.merchantAccountId;
      console.log(
        'Generating client token for merchant account:',
        req.query.merchantAccountId
      );
    }

    const response = await gateway.clientToken.generate(tokenConfig);
    res.json({ clientToken: response.clientToken });
  } catch (error) {
    console.error('Error generating client token:', error);
    res.status(500).json({ error: 'Failed to generate client token' });
  }
});

// Vault ACH payment method and process transaction
app.post('/api/ach-sale', async (req, res) => {
  const { paymentMethodNonce, amount, accountHolderName } = req.body;

  if (!paymentMethodNonce) {
    return res.status(400).json({ error: 'Payment method nonce is required' });
  }

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    console.log(
      'Step 1: Creating customer and vaulting payment method with network check verification...'
    );

    // Step 1: Create a customer
    const customerResult = await gateway.customer.create({
      firstName: accountHolderName?.split(' ')[0] || 'Bank Account',
      lastName: accountHolderName?.split(' ').slice(1).join(' ') || 'Customer',
    });

    if (!customerResult.success) {
      console.error('Customer creation failed:', customerResult.message);
      return res.status(400).json({
        success: false,
        error: customerResult.message,
      });
    }

    const customerId = customerResult.customer.id;
    console.log('Customer created:', customerId);

    // Step 2: Create payment method with network check verification
    console.log(
      'Step 2: Vaulting payment method with network check verification...'
    );

    let paymentMethodResult;
    try {
      paymentMethodResult = await gateway.paymentMethod.create({
        customerId: customerId,
        paymentMethodNonce: paymentMethodNonce,
        options: {
          usBankAccountVerificationMethod:
            braintree.UsBankAccountVerification.VerificationMethod.NetworkCheck,
        },
      });
    } catch (verificationError) {
      console.error(
        'Network check verification failed:',
        verificationError.message
      );
      console.log(
        'Falling back to creating payment method without verification...'
      );

      // Fallback: Create payment method without verification
      // Note: This will require micro-deposit verification in production
      paymentMethodResult = await gateway.paymentMethod.create({
        customerId: customerId,
        paymentMethodNonce: paymentMethodNonce,
      });
    }

    if (!paymentMethodResult.success) {
      console.error(
        'Payment method creation failed:',
        paymentMethodResult.message
      );
      console.error(
        'Full error:',
        JSON.stringify(paymentMethodResult, null, 2)
      );
      return res.status(400).json({
        success: false,
        error: paymentMethodResult.message,
      });
    }

    const paymentMethodToken = paymentMethodResult.paymentMethod.token;
    console.log('Payment method vaulted with token:', paymentMethodToken);
    console.log(
      'Full payment method result:',
      JSON.stringify(paymentMethodResult.paymentMethod, null, 2)
    );

    // Check verification status
    const verification = paymentMethodResult.paymentMethod.verifications?.[0];
    if (verification) {
      console.log('Verification found:', JSON.stringify(verification, null, 2));
      console.log('Verification status:', verification.status);
      if (verification.status !== 'verified') {
        console.error(
          `Verification failed with status: ${verification.status}`
        );
        return res.status(400).json({
          success: false,
          error: `Bank account verification failed: ${verification.status}`,
        });
      }
      console.log('✓ Bank account verified successfully');
    } else {
      console.warn('No verification object found in response');
    }

    // Step 3: Process transaction using the verified payment method token
    console.log(
      'Step 3: Processing transaction from verified payment method...'
    );

    const transactionResult = await gateway.transaction.sale({
      amount: parseFloat(amount).toFixed(2),
      paymentMethodToken: paymentMethodToken,
      options: {
        submitForSettlement: true,
      },
    });

    if (transactionResult.success) {
      console.log('Transaction successful:', transactionResult.transaction.id);
      console.log(
        'Full transaction result:',
        JSON.stringify(transactionResult.transaction, null, 2)
      );

      const response = {
        success: true,
        transaction: {
          id: transactionResult.transaction.id,
          status: transactionResult.transaction.status,
          amount: transactionResult.transaction.amount,
          usBankAccount: transactionResult.transaction.usBankAccount,
        },
        vaultedPaymentMethod: {
          token: paymentMethodToken,
          customerId: customerId,
          last4: transactionResult.transaction.usBankAccount?.last4,
          accountType: transactionResult.transaction.usBankAccount?.accountType,
          bankName: transactionResult.transaction.usBankAccount?.bankName,
          accountHolderName:
            transactionResult.transaction.usBankAccount?.accountHolderName,
          paymentType: 'US Bank Account',
        },
      };

      res.json(response);
    } else {
      console.error('Transaction failed:', transactionResult.message);
      res.status(400).json({
        success: false,
        error: transactionResult.message,
      });
    }
  } catch (error) {
    console.error('Error processing ACH payment:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to process ACH payment: ' + error.message,
    });
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
    bankAccount,
    vault,
    options,
    merchantAccountId,
  } = req.body;

  if (!paymentMethodNonce && !bankAccount) {
    return res
      .status(400)
      .json({ error: 'Payment method nonce or bank account is required' });
  }

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    const transactionData = {
      amount: parseFloat(amount).toFixed(2),
      options: {
        submitForSettlement: true,
      },
    };

    // Add merchant account ID if provided (for multi-currency support)
    if (merchantAccountId) {
      transactionData.merchantAccountId = merchantAccountId;
      console.log(
        'Processing transaction with merchant account:',
        merchantAccountId
      );
    }

    // Handle different payment methods
    if (paymentMethodNonce) {
      transactionData.paymentMethodNonce = paymentMethodNonce;
    } else if (bankAccount) {
      // ACH payments require tokenization on the client side
      // This fallback shouldn't be hit with proper client implementation
      return res.status(400).json({
        success: false,
        error:
          'ACH payments must be tokenized on the client side. Please use the US Bank Account SDK to generate a payment method nonce.',
      });
    }

    // Add billing address if provided
    if (billingAddress) {
      transactionData.billing = billingAddress;
    }

    // Add vaulting if requested
    if (vaultPaymentMethod || vault || (options && options.storeInVault)) {
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
          firstName: 'Bank Account',
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
      } else if (
        result.transaction.usBankAccount &&
        result.transaction.usBankAccount.token
      ) {
        // Handle vaulted US Bank Accounts (ACH)
        response.vaultedPaymentMethod = {
          token: result.transaction.usBankAccount.token,
          last4: result.transaction.usBankAccount.last4,
          accountType: result.transaction.usBankAccount.accountType,
          accountHolderName: result.transaction.usBankAccount.accountHolderName,
          bankName: result.transaction.usBankAccount.bankName,
          paymentType: 'US Bank Account',
          customerId: result.transaction.customer
            ? result.transaction.customer.id
            : null,
        };
        console.log(
          'US Bank Account vaulted with token:',
          result.transaction.usBankAccount.token
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

// Vault test endpoint - for testing duplicate payment method scenarios
app.post('/api/vault-test', async (req, res) => {
  const {
    paymentMethodNonce,
    amount,
    cardholderName,
    existingCustomerId,
    deviceData,
  } = req.body;

  if (!paymentMethodNonce) {
    return res.status(400).json({ error: 'Payment method nonce is required' });
  }

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    let customerId = existingCustomerId;

    // If no existing customer ID, create a new customer
    if (!customerId) {
      console.log('Creating new customer for vault test...');
      const customerResult = await gateway.customer.create({
        firstName: cardholderName || 'Test',
        lastName: 'Customer',
      });

      if (!customerResult.success) {
        console.error('Customer creation failed:', customerResult.message);
        return res.status(400).json({
          success: false,
          error: customerResult.message,
        });
      }

      customerId = customerResult.customer.id;
      console.log('New customer created:', customerId);
    } else {
      console.log('Using existing customer ID:', customerId);
    }

    // Create transaction with vaulting
    const transactionData = {
      amount: parseFloat(amount).toFixed(2),
      paymentMethodNonce: paymentMethodNonce,
      customer: {
        id: customerId,
      },
      options: {
        submitForSettlement: true,
        storeInVaultOnSuccess: true,
      },
    };

    if (deviceData) {
      transactionData.deviceData = deviceData;
    }

    console.log('Processing vault test transaction...');
    const result = await gateway.transaction.sale(transactionData);

    if (result.success) {
      console.log('Vault test transaction successful:', result.transaction.id);

      const response = {
        success: true,
        transaction: {
          id: result.transaction.id,
          status: result.transaction.status,
          amount: result.transaction.amount,
        },
        customerId: customerId,
      };

      // Include vault information
      if (
        result.transaction.creditCard &&
        result.transaction.creditCard.token
      ) {
        response.vaultedPaymentMethod = {
          token: result.transaction.creditCard.token,
          maskedNumber: result.transaction.creditCard.maskedNumber,
          cardType: result.transaction.creditCard.cardType,
          customerId: customerId,
        };
        console.log(
          'Payment method vaulted with token:',
          result.transaction.creditCard.token
        );
      }

      res.json(response);
    } else {
      console.error('Vault test transaction failed:', result.message);
      res.status(400).json({
        success: false,
        error: result.message,
      });
    }
  } catch (error) {
    console.error('Error in vault test:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process vault test: ' + error.message,
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
