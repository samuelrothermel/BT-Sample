# Braintree Payment Integration Samples

A comprehensive Express.js application demonstrating multiple Braintree payment integration patterns including Hosted Fields, Drop-in UI, Fastlane, ACH, and vaulted payment methods.

## Features

### Payment Integration Patterns

- **Hosted Fields**: Secure PCI-compliant card data collection with full customization
- **Drop-in UI**: Pre-built payment UI with minimal integration effort
- **Fastlane**: Accelerated checkout for returning customers
- **ACH Payments**: US bank account direct debit payments
- **Vaulted Payments**: Save and reuse payment methods for future transactions

### Alternative Payment Methods

- Credit/Debit Cards (Visa, Mastercard, Amex, Discover)
- PayPal (Standard & Vault Flow)
- Venmo (Mobile & Desktop with QR codes)
- Dedicated Venmo Sandbox testing page (enablement, auth-only, compliance summaries)
- Returning Payer + Pay Later Drop-in (guest/returning, vault all methods)
- Google Pay
- Apple Pay
- ACH Bank Transfers

### Advanced Features

- **Payment Vaulting**: Securely store payment methods for recurring/future use
- **Vaulted Token Transactions**: Process new transactions using previously vaulted tokens (bypasses re-verification for ACH)
- **Multi-Currency Support**: CAD and USD merchant account routing
- **Device Data Collection**: Fraud prevention with Kount/PayPal device data
- **Multiple Captures**: Partial capture testing for PayPal Pay Later
- **Recurring Billing**: Subscription and recurring payment support
- **Duplicate Testing**: Analyze duplicate payment method behavior

## Setup Instructions

### 1. Install Dependencies

The required dependencies are already included in `package.json`. If you need to install them:

```bash
npm install
```

### 2. Configure Braintree Credentials

1. Sign up for a [Braintree Sandbox account](https://www.braintreepayments.com/sandbox)
2. Get your sandbox credentials from the Braintree Control Panel
3. Update the `.env` file with your credentials:

```env
BRAINTREE_ENVIRONMENT=sandbox
BRAINTREE_MERCHANT_ID=your_merchant_id_here
BRAINTREE_PUBLIC_KEY=your_public_key_here
BRAINTREE_PRIVATE_KEY=your_private_key_here
# Optional: set after Venmo sandbox whitelist (shown on /venmo-sandbox.html)
VENMO_PROFILE_ID=your_venmo_profile_id_here
PORT=3000
```

### 3. Run the Application

**Development mode (with auto-restart):**

```bash
npm run dev
```

**Production mode:**

```bash
npm start
```

### 4. Test the Integration

1. Open your browser and go to `http://localhost:3000`
2. Choose from multiple payment integration samples:
   - **Hosted Fields**: Full-featured card and alternative payments
   - **Hosted Fields CAD**: Multi-currency (Canadian Dollar) support
   - **ACH Only**: Dedicated bank account payment testing
   - **Venmo Sandbox**: US/USD Venmo with sandbox enablement, auth-only capture flow, and compliance order summaries
   - **Returning Payer + Pay Later**: Guest/returning Drop-in with Pay Later and vault-all payment methods
   - **Hosted Fields Vaulted**: Payment vaulting with all payment methods
   - **Vaulted Token Sale**: Process new transactions with previously saved tokens (great for testing ACH recurring payments!)
   - **Drop-in UI**: Pre-built payment interface
   - **Drop-in Vaulted**: Drop-in with automatic vaulting
   - **Fastlane**: Accelerated checkout experience
   - **Duplicate Testing**: Payment method duplication analysis
   - **Recurring Billing**: Subscription payment testing
   - **Multiple Captures**: Pay Later partial capture testing

3. Use Braintree's [test card numbers](https://developer.paypal.com/braintree/docs/reference/general/testing#test-credit-card-numbers):
   - **Visa**: 4111111111111111
   - **Mastercard**: 5555555555554444
   - **American Express**: 378282246310005
4. For ACH testing, use any valid 9-digit routing number and account number
5. Use any future expiration date (e.g., 12/25)
6. Use any 3-digit CVV (4 digits for Amex)
7. Enter any valid postal code

### 5. Testing Vaulted Token Transactions

To test the **Vaulted Token Sale** feature (process transactions with previously saved payment methods):

1. **Create a vaulted payment method first:**
   - Visit the "ACH Only" or "Hosted Fields Vaulted" page
   - Complete a transaction with vaulting enabled
   - Copy the payment method token from the success message

2. **Use the token for a new transaction:**
   - Visit the "Vaulted Token Sale" page
   - Paste the payment method token
   - Enter a new amount
   - Submit to process the transaction

**Benefits**: This bypasses verification for ACH payments and simulates recurring billing scenarios.

## Project Structure

```
├── public/
│   ├── index.html                  # Landing page with all samples
│   ├── hosted-fields.html          # Hosted Fields with alternative payments
│   ├── hosted-fields.js
│   ├── hosted-fields.css
│   ├── hosted-fields-cad.html      # Multi-currency (CAD) version
│   ├── hosted-fields-cad.js
│   ├── ach-only.html               # ACH-focused implementation
│   ├── ach-only.js
│   ├── ach-only.css
│   ├── hosted-vaulted.html         # Comprehensive vaulting demo
│   ├── hosted-vaulted.js
│   ├── hosted-vaulted.css
│   ├── vaulted-token-sale.html     # Transaction with vaulted tokens (NEW!)
│   ├── vaulted-token-sale.js       # Process sales using saved payment tokens
│   ├── vaulted-token-sale.css
│   ├── drop-in.html                # Drop-in UI
│   ├── drop-in.js
│   ├── drop-in.css
│   ├── drop-in-vaulted.html        # Drop-in with vaulting
│   ├── drop-in-vaulted.js
│   ├── drop-in-vaulted.css
│   ├── fastlane.html               # Fastlane accelerated checkout
│   ├── fastlane.js
│   ├── fastlane.css
│   ├── duplicate-test.html         # Duplicate payment method testing
│   ├── duplicate-test.js
│   ├── duplicate-test.css
│   ├── recurring-billing.html      # Subscription billing demo
│   ├── recurring-billing.js
│   ├── recurring-billing.css
│   ├── multiple-captures.html      # Multiple capture testing
│   ├── multiple-captures.js
│   ├── multiple-captures.css
│   └── styles.css                  # Shared CSS styles
├── server.js                       # Express server with all API endpoints
├── generate-report.js              # Transaction reporting utility
├── package.json                    # Dependencies and scripts
├── .env                           # Environment configuration
└── README.md                      # This file
```

## API Endpoints

### Payment Processing

- `GET /client_token` - Returns a Braintree client token for authentication
  - Optional: `?merchantAccountId=<id>` for multi-currency support
- `POST /api/sale` - Process payment transactions
  - Accepts `paymentMethodNonce` (new payment) OR `paymentMethodToken` (vaulted payment)
  - Supports vaulting with `vault: true` or `options.storeInVault: true`
- `POST /api/ach-sale` - Process ACH with network check verification and automatic vaulting
- `POST /api/authorize` - Create payment authorization (for Pay Later)
- `POST /api/capture` - Capture authorized funds

### Vaulting & Subscriptions

- `POST /api/vault-test` - Test vaulting with existing or new customers
- `POST /api/vault-payment-method` - Vault payment methods separately
- `POST /api/create-subscription` - Create recurring billing subscriptions

### Transaction Management

- `GET /api/transaction/:id` - Get transaction details and status

## Security Features

- **Hosted Fields**: Card data never touches your server
- **Client Token**: Secure authentication for client-side operations
- **Environment Variables**: Sensitive credentials stored securely
- **Input Validation**: Server-side validation of payment data
- **Error Handling**: Secure error messages without exposing sensitive data

## Customization

### Styling

Modify `public/styles.css` to customize the appearance of the payment form.

### Validation

Update the Hosted Fields configuration in `public/app.js` to change validation rules or styling.

### Server Logic

Extend `server.js` to add additional payment processing logic, webhooks, or database integration.

## Production Considerations

1. **SSL Certificate**: Use HTTPS in production
2. **Environment**: Change `BRAINTREE_ENVIRONMENT` to `production`
3. **Error Logging**: Implement proper error logging
4. **Rate Limiting**: Add rate limiting to prevent abuse
5. **Webhook Verification**: Implement webhook signature verification
6. **Database Integration**: Store transaction records
7. **User Authentication**: Add user authentication if required

## Troubleshooting

### Common Issues

1. **Client token generation fails**
   - Verify your Braintree credentials in the `.env` file
   - Ensure you're using sandbox credentials for testing

2. **Hosted Fields not loading**
   - Check browser console for JavaScript errors
   - Verify the Braintree client token is being fetched successfully

3. **Payment processing fails**
   - Verify you're using valid test card numbers
   - Check server logs for detailed error messages

## Resources

- [Braintree Developer Documentation](https://developer.paypal.com/braintree/docs/)
- [Hosted Fields Guide](https://developer.paypal.com/braintree/docs/guides/hosted-fields)
- [Test Card Numbers](https://developer.paypal.com/braintree/docs/reference/general/testing#test-credit-card-numbers)
- [Braintree Node.js SDK](https://github.com/braintree/braintree_node)
