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
        'apple-developer-merchantid-domain-association',
      ),
    );
  },
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
        req.query.merchantAccountId,
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
      'Step 1: Creating customer and vaulting payment method with network check verification...',
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
      'Step 2: Vaulting payment method with network check verification...',
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
        verificationError.message,
      );
      console.log(
        'Falling back to creating payment method without verification...',
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
        paymentMethodResult.message,
      );
      console.error(
        'Full error:',
        JSON.stringify(paymentMethodResult, null, 2),
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
      JSON.stringify(paymentMethodResult.paymentMethod, null, 2),
    );

    // Check verification status
    const verification = paymentMethodResult.paymentMethod.verifications?.[0];
    if (verification) {
      console.log('Verification found:', JSON.stringify(verification, null, 2));
      console.log('Verification status:', verification.status);
      if (verification.status !== 'verified') {
        console.error(
          `Verification failed with status: ${verification.status}`,
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
      'Step 3: Processing transaction from verified payment method...',
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
        JSON.stringify(transactionResult.transaction, null, 2),
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
    paymentMethodToken,
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

  if (!paymentMethodNonce && !paymentMethodToken && !bankAccount) {
    return res.status(400).json({
      error:
        'Payment method nonce, payment method token, or bank account is required',
    });
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
        merchantAccountId,
      );
    }

    // Handle different payment methods
    if (paymentMethodToken) {
      // Use a vaulted payment method token (bypasses verification)
      transactionData.paymentMethodToken = paymentMethodToken;
      console.log(
        'Processing transaction with vaulted payment method token:',
        paymentMethodToken,
      );
    } else if (paymentMethodNonce) {
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
        JSON.stringify(result.transaction, null, 2),
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
          result.transaction.creditCard.token,
        );
        if (result.transaction.customer) {
          console.log('Customer ID:', result.transaction.customer.id);
        }
      } else if (result.transaction.paypal && result.transaction.paypal.token) {
        // Handle vaulted PayPal accounts
        let token = result.transaction.paypal.token;

        console.log(
          'PayPal transaction details:',
          JSON.stringify(result.transaction.paypal, null, 2),
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
          result.transaction.venmoAccount.token,
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
          result.transaction.androidPayCard.token,
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
          result.transaction.usBankAccount.token,
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
    let customerExists = false;

    // If customer ID is provided, check if it exists
    if (customerId) {
      console.log('Checking if customer exists:', customerId);
      try {
        const customerResult = await gateway.customer.find(customerId);
        customerExists = true;
        customerId = customerResult.id; // Ensure we use the exact ID from Braintree
        console.log('✓ Customer found:', customerId);
        console.log('Customer details:', {
          id: customerResult.id,
          firstName: customerResult.firstName,
          lastName: customerResult.lastName,
          paymentMethodCount: customerResult.paymentMethods?.length || 0,
        });
      } catch (findError) {
        console.log(
          '✗ Customer not found, will create new customer with ID:',
          customerId,
        );
        customerExists = false;
      }
    }

    // Only create a new customer if one doesn't exist
    if (!customerExists) {
      console.log('Creating new customer for vault test...');
      const customerData = {
        firstName: cardholderName || 'Test',
        lastName: 'Customer',
      };

      // If a specific customer ID was requested, try to create with that ID
      if (customerId) {
        customerData.id = customerId;
      }

      const customerResult = await gateway.customer.create(customerData);

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
      console.log('Using existing customer ID for vaulting:', customerId);
    }

    // For existing customers, vault the payment method first, then transact with the token
    let paymentMethodToken = null;

    if (customerExists) {
      console.log('Customer exists - vaulting payment method separately...');

      const paymentMethodResult = await gateway.paymentMethod.create({
        customerId: customerId,
        paymentMethodNonce: paymentMethodNonce,
        options: {
          verifyCard: true, // Verify the card during vaulting
        },
      });

      if (!paymentMethodResult.success) {
        console.error(
          'Payment method vaulting failed:',
          paymentMethodResult.message,
        );
        return res.status(400).json({
          success: false,
          error: paymentMethodResult.message,
        });
      }

      paymentMethodToken = paymentMethodResult.paymentMethod.token;
      console.log('Payment method vaulted with token:', paymentMethodToken);

      // Now create transaction using the vaulted payment method token
      const transactionData = {
        amount: parseFloat(amount).toFixed(2),
        paymentMethodToken: paymentMethodToken,
        options: {
          submitForSettlement: true,
        },
      };

      if (deviceData) {
        transactionData.deviceData = deviceData;
      }

      console.log('Processing transaction with vaulted payment method...');
      const result = await gateway.transaction.sale(transactionData);

      if (result.success) {
        console.log('Transaction successful:', result.transaction.id);

        const response = {
          success: true,
          transaction: {
            id: result.transaction.id,
            status: result.transaction.status,
            amount: result.transaction.amount,
          },
          customerId: customerId,
          vaultedPaymentMethod: {
            token: paymentMethodToken,
            maskedNumber:
              paymentMethodResult.paymentMethod.maskedNumber ||
              result.transaction.creditCard?.maskedNumber,
            cardType:
              paymentMethodResult.paymentMethod.cardType ||
              result.transaction.creditCard?.cardType,
            customerId: customerId,
          },
        };

        res.json(response);
      } else {
        console.error('Transaction failed:', result.message);
        res.status(400).json({
          success: false,
          error: result.message,
        });
      }
    } else {
      // For new customers, use the transaction to vault and process in one step
      console.log('New customer - vaulting via transaction...');

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
        console.log(
          'Vault test transaction successful:',
          result.transaction.id,
        );

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
            result.transaction.creditCard.token,
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
    }
  } catch (error) {
    console.error('Error in vault test:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process vault test: ' + error.message,
    });
  }
});

// Vault payment method for recurring billing
app.post('/api/vault-payment-method', async (req, res) => {
  const { paymentMethodNonce, firstName, lastName, deviceData } = req.body;

  if (!paymentMethodNonce) {
    return res.status(400).json({ error: 'Payment method nonce is required' });
  }

  try {
    console.log('Creating customer for payment method vaulting...');

    // Step 1: Create a customer
    const customerResult = await gateway.customer.create({
      firstName: firstName || 'Customer',
      lastName: lastName || '',
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

    // Step 2: Vault the payment method
    console.log('Vaulting payment method for customer:', customerId);

    const paymentMethodData = {
      customerId: customerId,
      paymentMethodNonce: paymentMethodNonce,
      options: {
        verifyCard: false, // Set to true if you want to verify credit cards
      },
    };

    if (deviceData) {
      paymentMethodData.deviceData = deviceData;
    }

    const paymentMethodResult =
      await gateway.paymentMethod.create(paymentMethodData);

    if (!paymentMethodResult.success) {
      console.error(
        'Payment method creation failed:',
        paymentMethodResult.message,
      );
      return res.status(400).json({
        success: false,
        error: paymentMethodResult.message,
      });
    }

    const paymentMethodToken = paymentMethodResult.paymentMethod.token;
    console.log('Payment method vaulted with token:', paymentMethodToken);

    // Prepare response with payment method details
    const response = {
      success: true,
      customerId: customerId,
      paymentMethodToken: paymentMethodToken,
    };

    // Add specific details based on payment method type
    if (paymentMethodResult.paymentMethod.usBankAccount) {
      const bankAccount = paymentMethodResult.paymentMethod.usBankAccount;
      response.last4 = bankAccount.last4;
      response.accountType = bankAccount.accountType;
      response.bankName = bankAccount.bankName;
      response.accountHolderName = bankAccount.accountHolderName;
      response.paymentType = 'US Bank Account';
    } else if (paymentMethodResult.paymentMethod.maskedNumber) {
      response.maskedNumber = paymentMethodResult.paymentMethod.maskedNumber;
      response.cardType = paymentMethodResult.paymentMethod.cardType;
      response.paymentType = 'Credit Card';
    }

    res.json(response);
  } catch (error) {
    console.error('Error vaulting payment method:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to vault payment method: ' + error.message,
    });
  }
});

// Create subscription with vaulted payment method
app.post('/api/create-subscription', async (req, res) => {
  const { paymentMethodToken, planId } = req.body;

  if (!paymentMethodToken) {
    return res.status(400).json({ error: 'Payment method token is required' });
  }

  if (!planId) {
    return res.status(400).json({ error: 'Plan ID is required' });
  }

  try {
    console.log(
      'Creating subscription with payment method:',
      paymentMethodToken,
    );
    console.log('Plan ID:', planId);

    const subscriptionData = {
      paymentMethodToken: paymentMethodToken,
      planId: planId,
    };

    const result = await gateway.subscription.create(subscriptionData);

    if (result.success) {
      console.log('Subscription created successfully:', result.subscription.id);
      console.log(
        'Full subscription result:',
        JSON.stringify(result.subscription, null, 2),
      );

      const response = {
        success: true,
        subscription: {
          id: result.subscription.id,
          status: result.subscription.status,
          planId: result.subscription.planId,
          price: result.subscription.price,
          firstBillingDate: result.subscription.firstBillingDate,
          nextBillingDate: result.subscription.nextBillingDate,
          billingPeriodStartDate: result.subscription.billingPeriodStartDate,
          billingPeriodEndDate: result.subscription.billingPeriodEndDate,
          currentBillingCycle: result.subscription.currentBillingCycle,
        },
      };

      res.json(response);
    } else {
      console.error('Subscription creation failed:', result.message);
      console.error('Full error result:', JSON.stringify(result, null, 2));

      // Provide more detailed error information
      let errorMessage = result.message;
      const errorDetails = {};

      if (result.errors && result.errors.deepErrors) {
        const deepErrors = result.errors.deepErrors();
        if (deepErrors.length > 0) {
          const detailedErrors = deepErrors.map(e => ({
            code: e.code,
            message: e.message,
            attribute: e.attribute,
          }));
          console.error(
            'Deep errors:',
            JSON.stringify(detailedErrors, null, 2),
          );
          errorMessage += ': ' + deepErrors.map(e => e.message).join(', ');
          errorDetails.deepErrors = detailedErrors;
        }
      }

      // Extract transaction/request information
      const debugInfo = {
        success: false,
        error: errorMessage,
        errorDetails: errorDetails,
        requestId: result.transaction?.id || result.subscription?.id || 'N/A',
        params: {
          paymentMethodToken: paymentMethodToken,
          planId: planId,
        },
      };

      console.error(
        'Returning error response:',
        JSON.stringify(debugInfo, null, 2),
      );
      res.status(400).json(debugInfo);
    }
  } catch (error) {
    console.error('Error creating subscription:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });

    const errorResponse = {
      success: false,
      error: 'Failed to create subscription: ' + error.message,
      errorDetails: {
        type: error.name,
        code: error.code,
      },
      params: {
        paymentMethodToken: paymentMethodToken,
        planId: planId,
      },
      timestamp: new Date().toISOString(),
    };

    console.error(
      'Returning error response:',
      JSON.stringify(errorResponse, null, 2),
    );
    res.status(500).json(errorResponse);
  }
});

// Create crypto payment context via Braintree GraphQL API
// The Node server SDK does not yet have a wrapper for createLocalPaymentContext,
// so we call the GraphQL endpoint directly using the public/private key for Basic auth.
app.post('/api/crypto-payment-context', async (req, res) => {
  const {
    amount,
    currency,
    returnUrl,
    cancelUrl,
    buyerDetails,
    merchantAccountId,
  } = req.body;

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  // Use the crypto-specific merchant account ID from env, or fall back to the
  // value passed by the client (allows overriding per request during testing)
  const cryptoMerchantAccountId =
    merchantAccountId ||
    process.env.BRAINTREE_CRYPTO_MERCHANT_ACCOUNT_ID ||
    process.env.BRAINTREE_MERCHANT_ID;

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const resolvedReturnUrl = returnUrl || `${baseUrl}/pay-with-crypto.html`;
  const resolvedCancelUrl = cancelUrl || `${baseUrl}/pay-with-crypto.html?cancelled=true`;

  // GraphQL mutation from the integration guide
  const mutation = `
    mutation CreateLocalPaymentContext($input: CreateLocalPaymentContextInput!) {
      createLocalPaymentContext(input: $input) {
        paymentContext {
          id
          type
          paymentId
          approvalUrl
          merchantAccountId
          createdAt
          amount {
            value
            currencyCode
          }
        }
      }
    }
  `;

  const variables = {
    input: {
      amount: {
        value: parseFloat(amount).toFixed(2),
        currencyCode: currency || 'USD',
      },
      type: 'CRYPTO',
      merchantAccountId: cryptoMerchantAccountId,
      returnUrl: resolvedReturnUrl,
      cancelUrl: resolvedCancelUrl,
      countryCode: req.body.countryCode || 'US',
      payerGivenName: buyerDetails?.firstName || 'Test',
      payerSurname: buyerDetails?.lastName || 'Buyer',
      payerEmail: buyerDetails?.email || 'test@example.com',
    },
  };

  // Braintree GraphQL endpoint (sandbox vs production)
  const isSandbox =
    (process.env.BRAINTREE_ENVIRONMENT || 'sandbox').toLowerCase() !== 'production';
  const graphqlUrl = isSandbox
    ? 'https://payments.sandbox.braintree-api.com/graphql'
    : 'https://payments.braintree-api.com/graphql';

  // Basic auth: public_key:private_key encoded as Base64
  const credentials = Buffer.from(
    `${process.env.BRAINTREE_PUBLIC_KEY}:${process.env.BRAINTREE_PRIVATE_KEY}`
  ).toString('base64');

  console.log('Creating crypto payment context via GraphQL:', {
    amount: variables.input.amount,
    merchantAccountId: cryptoMerchantAccountId,
    returnUrl: resolvedReturnUrl,
  });

  try {
    const https = require('https');
    const body = JSON.stringify({ query: mutation, variables });

    const graphqlResponse = await new Promise((resolve, reject) => {
      const url = new URL(graphqlUrl);
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${credentials}`,
          'Braintree-Version': '2019-01-01',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject(new Error('Failed to parse GraphQL response: ' + data));
          }
        });
      });

      request.on('error', reject);
      request.write(body);
      request.end();
    });

    console.log('GraphQL response status:', graphqlResponse.status);
    console.log('GraphQL response body:', JSON.stringify(graphqlResponse.body, null, 2));

    const gqlBody = graphqlResponse.body;

    if (gqlBody.errors && gqlBody.errors.length > 0) {
      const errMsg = gqlBody.errors.map(e => e.message).join('; ');
      console.error('GraphQL errors:', errMsg);
      return res.status(400).json({
        success: false,
        error: errMsg,
        graphqlErrors: gqlBody.errors,
      });
    }

    const paymentContext = gqlBody.data?.createLocalPaymentContext?.paymentContext;
    if (!paymentContext) {
      return res.status(500).json({
        success: false,
        error: 'No paymentContext in GraphQL response',
        rawResponse: gqlBody,
      });
    }

    // Decode the GraphQL ID from Base64 to legacy format (as shown in the Ruby guide)
    let legacyId = paymentContext.id;
    try {
      const decoded = Buffer.from(paymentContext.id, 'base64').toString('utf8');
      legacyId = decoded.split('#').pop() || paymentContext.id;
    } catch (_) {
      // If decoding fails, use the raw ID
    }

    console.log('Crypto payment context created successfully:', {
      id: legacyId,
      paymentId: paymentContext.paymentId,
      approvalUrl: paymentContext.approvalUrl,
    });

    res.json({
      success: true,
      id: legacyId,
      paymentContextId: legacyId,
      paymentId: paymentContext.paymentId,
      approvalUrl: paymentContext.approvalUrl,
      amount: paymentContext.amount,
      type: paymentContext.type,
    });
  } catch (error) {
    console.error('Error calling Braintree GraphQL for crypto payment context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create crypto payment context: ' + error.message,
    });
  }
});

// Process crypto transaction after the buyer approves the payment context
// Called after the full-page redirect returns with a nonce
app.post('/api/crypto-sale', async (req, res) => {
  const { paymentMethodNonce, amount } = req.body;

  if (!paymentMethodNonce) {
    return res.status(400).json({ error: 'Payment method nonce is required' });
  }

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    console.log('Processing crypto transaction with nonce:', paymentMethodNonce);

    const result = await gateway.transaction.sale({
      amount: parseFloat(amount).toFixed(2),
      paymentMethodNonce: paymentMethodNonce,
      options: {
        submitForSettlement: true,
      },
    });

    if (result.success) {
      console.log('Crypto transaction successful:', result.transaction.id);
      console.log('Full transaction result:', JSON.stringify(result.transaction, null, 2));

      res.json({
        success: true,
        transaction: {
          id: result.transaction.id,
          status: result.transaction.status,
          amount: result.transaction.amount,
          paymentInstrumentType: result.transaction.paymentInstrumentType,
        },
      });
    } else {
      console.error('Crypto transaction failed:', result.message);
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Error processing crypto transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process crypto transaction: ' + error.message,
    });
  }
});

// Create authorization (without submitting for settlement) - for testing multiple captures
app.post('/api/authorize', async (req, res) => {
  const { paymentMethodNonce, amount, merchantAccountId } = req.body;

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
        submitForSettlement: false, // This creates an authorization only
      },
    };

    // Add merchant account ID if provided
    if (merchantAccountId) {
      transactionData.merchantAccountId = merchantAccountId;
      console.log(
        'Creating authorization with merchant account:',
        merchantAccountId,
      );
    }

    console.log(
      'Creating authorization:',
      JSON.stringify(transactionData, null, 2),
    );

    const result = await gateway.transaction.sale(transactionData);

    if (result.success) {
      console.log('Authorization successful:', result.transaction.id);
      console.log(
        'Full transaction result:',
        JSON.stringify(result.transaction, null, 2),
      );

      res.json({
        success: true,
        transaction: {
          id: result.transaction.id,
          status: result.transaction.status,
          amount: result.transaction.amount,
          type: result.transaction.type,
          paymentInstrumentType: result.transaction.paymentInstrumentType,
          createdAt: result.transaction.createdAt,
          paypal: result.transaction.paypal,
        },
      });
    } else {
      console.error('Authorization failed:', result.message);
      res.status(400).json({
        success: false,
        error: result.message,
      });
    }
  } catch (error) {
    console.error('Error creating authorization:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create authorization: ' + error.message,
    });
  }
});

// Get transaction details
app.get('/api/transaction/:id', async (req, res) => {
  const { id } = req.params;

  try {
    console.log('Fetching transaction details for:', id);
    const transaction = await gateway.transaction.find(id);

    res.json({
      success: true,
      transaction: {
        id: transaction.id,
        status: transaction.status,
        type: transaction.type,
        amount: transaction.amount,
        paymentInstrumentType: transaction.paymentInstrumentType,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        refundedTransactionId: transaction.refundedTransactionId,
        paypal: transaction.paypal,
      },
    });
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transaction: ' + error.message,
    });
  }
});

// Perform partial capture (submit for partial settlement)
app.post('/api/capture', async (req, res) => {
  const { transactionId, amount } = req.body;

  if (!transactionId) {
    return res.status(400).json({ error: 'Transaction ID is required' });
  }

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    console.log(
      `Attempting partial capture of ${amount} on transaction ${transactionId}`,
    );

    const result = await gateway.transaction.submitForPartialSettlement(
      transactionId,
      parseFloat(amount).toFixed(2),
    );

    if (result.success) {
      console.log('Partial capture successful:', result.transaction.id);
      console.log(
        'Full capture result:',
        JSON.stringify(result.transaction, null, 2),
      );

      res.json({
        success: true,
        transaction: {
          id: result.transaction.id,
          status: result.transaction.status,
          amount: result.transaction.amount,
          type: result.transaction.type,
          paymentInstrumentType: result.transaction.paymentInstrumentType,
          createdAt: result.transaction.createdAt,
          authorizedTransactionId: transactionId,
        },
      });
    } else {
      console.error('Partial capture failed:', result.message);

      // Extract detailed error information
      let errorMessage = result.message;
      if (result.errors && result.errors.deepErrors) {
        const deepErrors = result.errors.deepErrors();
        if (deepErrors.length > 0) {
          errorMessage += ': ' + deepErrors.map(e => e.message).join(', ');
        }
      }

      res.status(400).json({
        success: false,
        error: errorMessage,
      });
    }
  } catch (error) {
    console.error('Error performing partial capture:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to capture transaction: ' + error.message,
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
    'Make sure to update your .env file with your Braintree credentials',
  );
});
