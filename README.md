# Braintree Hosted Fields Integration

A simple Express.js application demonstrating Braintree Hosted Fields integration for secure payment processing.

## Features

- **Hosted Fields**: Secure PCI-compliant card data collection
- **Server-side SDK**: Complete payment processing with the Braintree Node.js SDK
- **Client-side SDK**: Braintree JavaScript SDK for tokenization
- **Responsive Design**: Mobile-friendly payment form
- **Real-time Validation**: Field validation with visual feedback
- **Error Handling**: Comprehensive error handling and user feedback

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
2. Use Braintree's [test card numbers](https://developer.paypal.com/braintree/docs/reference/general/testing#test-credit-card-numbers):
   - **Visa**: 4111111111111111
   - **Mastercard**: 5555555555554444
   - **American Express**: 378282246310005
3. Use any future expiration date (e.g., 12/25)
4. Use any 3-digit CVV (4 digits for Amex)
5. Enter any valid postal code

## Project Structure

```
├── public/
│   ├── index.html      # Main payment page
│   ├── styles.css      # CSS styling
│   └── app.js          # Client-side JavaScript
├── server.js           # Express server with Braintree integration
├── package.json        # Dependencies and scripts
├── .env               # Environment configuration
└── README.md          # This file
```

## API Endpoints

- `GET /` - Serves the main payment page
- `GET /client_token` - Returns a Braintree client token for authentication
- `POST /checkout` - Processes payments using Braintree's transaction API

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
