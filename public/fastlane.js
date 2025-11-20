// Fastlane integration for Braintree
document.addEventListener('DOMContentLoaded', async function () {
  let braintreeClient;
  let fastlaneInstance;
  let deviceData;
  let customerData = null;
  let isGuestUser = true;

  // Initialize Braintree and Fastlane
  async function initializeBraintree() {
    try {
      // Fetch client token from server
      const tokenResponse = await fetch('/client_token');
      const tokenData = await tokenResponse.json();

      if (!tokenData.clientToken) {
        throw new Error('Failed to get client token from server');
      }

      // Create Braintree client
      braintreeClient = await braintree.client.create({
        authorization: tokenData.clientToken,
      });

      console.log('Braintree client created successfully');

      // Initialize Device Data Collector for fraud prevention
      try {
        const dataCollector = await braintree.dataCollector.create({
          client: braintreeClient,
          paypal: true,
        });
        deviceData = dataCollector.deviceData;
        console.log('Device data collector initialized');
      } catch (error) {
        console.warn('Device data collector failed to initialize:', error);
        deviceData = null;
      }

      // Initialize Fastlane
      await initializeFastlane();
    } catch (error) {
      console.error('Failed to initialize Braintree:', error);
      showResult(
        'Error initializing payment system: ' + error.message,
        'error'
      );
    }
  }

  // Initialize Fastlane following official Braintree documentation
  async function initializeFastlane() {
    try {
      // Define custom styling for Fastlane component (optional)
      const styles = {
        root: {
          backgroundColorPrimary: '#ffffff',
        },
      };

      // Initialize Fastlane component following official pattern
      const fastlane = await braintree.fastlane.create({
        authorization: braintreeClient.getConfiguration().authorization,
        client: braintreeClient,
        deviceData: deviceData,
        styles: styles,
      });

      // Extract identity, profile and events from the fastlane response
      const identity = fastlane.identity;
      const profile = fastlane.profile;
      const {
        checkoutPageLoaded,
        apmSelected,
        emailSubmitted,
        orderPlaced,
        checkoutEnd,
        storeAccountCreated,
      } = fastlane.events;

      // Store globally for use in other functions
      fastlaneInstance = fastlane;
      window.fastlaneIdentity = identity;
      window.fastlaneProfile = profile;
      window.fastlaneEvents = fastlane.events;

      console.log('Fastlane instance created successfully');

      // Initialize Fastlane watermark
      await initializeFastlaneWatermark();
    } catch (error) {
      console.error('Failed to initialize Fastlane:', error);
      console.warn('Falling back to demo mode');
      fastlaneInstance = null;

      // Still initialize watermark in demo mode
      await initializeFastlaneWatermark();
    }
  }

  // Initialize Fastlane watermark
  async function initializeFastlaneWatermark() {
    try {
      if (fastlaneInstance && fastlaneInstance.FastlaneWatermarkComponent) {
        const fastlaneWatermark =
          await fastlaneInstance.FastlaneWatermarkComponent({
            includeAdditionalInfo: true, // Boolean which determines if the info icon is present
          });
        await fastlaneWatermark.render('#watermark-container');
        console.log('Fastlane watermark rendered successfully');
      } else {
        // Fallback to static image if Fastlane watermark component is not available
        console.warn(
          'Fastlane watermark component not available, using fallback'
        );
        const watermarkContainer = document.getElementById(
          'watermark-container'
        );
        if (watermarkContainer) {
          const img = watermarkContainer.querySelector('img');
          if (img) {
            img.style.cursor = 'pointer';
            img.title = 'Powered by Fastlane - Accelerated checkout experience';
          }
        }
      }
    } catch (error) {
      console.warn('Failed to initialize Fastlane watermark:', error);
    }
  }

  // Simulate Fastlane components for demo
  function simulateFastlaneComponents() {
    const shippingComponent = document.getElementById('shipping-component');
    const paymentComponent = document.getElementById('payment-component');

    // Simulate shipping component
    shippingComponent.innerHTML = `
            <div style="text-align: left; width: 100%;">
                <div style="margin-bottom: 10px;">
                    <strong>Shipping Address</strong>
                </div>
                <div style="color: #666; font-size: 14px;">
                    123 Demo Street<br>
                    San Francisco, CA 94105<br>
                    United States
                </div>
            </div>
        `;
    shippingComponent.classList.add('loaded');

    // Simulate payment component
    paymentComponent.innerHTML = `
            <div style="text-align: left; width: 100%;">
                <div style="margin-bottom: 10px;">
                    <strong>Payment Method</strong>
                </div>
                <div style="color: #666; font-size: 14px; display: flex; align-items: center; gap: 10px;">
                    <div style="width: 40px; height: 25px; background: #1565c0; border-radius: 4px; color: white; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">VISA</div>
                    •••• •••• •••• 1234
                </div>
            </div>
        `;
    paymentComponent.classList.add('loaded');

    // Enable the Place Order button for demo components
    const placeOrderButton = document.getElementById('place-order');
    if (placeOrderButton) {
      placeOrderButton.disabled = false;
      console.log('Place Order button enabled (simulation mode)');
    }
  }

  // Handle email form submission with real Fastlane lookup
  async function handleEmailSubmit(event) {
    const emailInput = document.getElementById('email');
    const email = emailInput.value.trim();

    if (!email || !isValidEmail(email)) {
      showResult('Please enter a valid email address', 'error');
      return;
    }

    const continueButton = document.getElementById('continue-button');
    continueButton.disabled = true;
    continueButton.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <span>Checking email...</span>
            </div>
        `;

    try {
      let customerContextId = null;
      let renderFastlaneMemberExperience = false;

      if (window.fastlaneIdentity) {
        // Use real Fastlane SDK for customer lookup
        try {
          const lookupResult =
            await window.fastlaneIdentity.lookupCustomerByEmail(email);
          customerContextId = lookupResult.customerContextId;
          console.log('Fastlane customer lookup completed:', lookupResult);
        } catch (lookupError) {
          console.warn('Fastlane customer lookup failed:', lookupError);
          customerContextId = null;
        }
      } else {
        console.warn('Fastlane SDK not available, using demo behavior');
        // Demo behavior: randomly determine if user is returning (30% chance)
        customerContextId =
          Math.random() < 0.3 ? 'demo-customer-context-' + Date.now() : null;
      }

      if (customerContextId) {
        // Email is associated with a Fastlane member or a PayPal member
        // Send customerContextId to trigger the authentication flow
        showResult('Existing customer found. Please authenticate...', 'info');

        const { authenticationState, profileData } =
          await window.fastlaneIdentity.triggerAuthenticationFlow(
            customerContextId
          );

        if (authenticationState === 'succeeded') {
          // Fastlane member successfully authenticated themselves
          // profileData contains their profile details
          renderFastlaneMemberExperience = true;
          customerData = {
            email: email,
            name: profileData.name,
            shippingAddress: profileData.shippingAddress,
            card: profileData.card,
          };
          isGuestUser = false;
          showResult(
            'Welcome back! Your information has been pre-filled.',
            'success'
          );
        } else {
          // Member failed or cancelled to authenticate. Treat them as a guest payer
          renderFastlaneMemberExperience = false;
          isGuestUser = true;
          showResult('Authentication cancelled. Continuing as guest.', 'info');
        }
      } else {
        // No profile found with this email address. This is a guest payer
        renderFastlaneMemberExperience = false;
        isGuestUser = true;
        showResult('New customer. Continuing as guest.', 'info');
      }

      // Show checkout sections and render payment component
      document.getElementById('fastlane-checkout').style.display = 'block';
      document.getElementById('email-section').style.display = 'none';

      // Render Fastlane payment component
      await renderFastlanePaymentComponent(renderFastlaneMemberExperience);
    } catch (error) {
      console.error('Error during email check:', error);

      // Fallback to guest experience if Fastlane lookup fails
      console.warn('Fastlane lookup failed, falling back to guest experience');
      isGuestUser = true;
      customerData = null;

      // Show checkout sections with guest experience
      document.getElementById('fastlane-checkout').style.display = 'block';
      document.getElementById('email-section').style.display = 'none';

      // Render payment component for guest
      await renderFastlanePaymentComponent(false);

      showResult(
        'Continuing as guest user (Fastlane lookup unavailable)',
        'info'
      );
    } finally {
      continueButton.disabled = false;
      continueButton.innerHTML = 'Continue';
    }
  }

  // Render Fastlane Payment Component
  async function renderFastlanePaymentComponent(isMemberExperience) {
    try {
      if (!fastlaneInstance || !fastlaneInstance.FastlanePaymentComponent) {
        throw new Error('Fastlane payment component not available');
      }

      // Define options with fields and styles following documentation pattern
      const options = {
        fields: {
          phoneNumber: {
            // Example of how to prefill the phone number field in the FastlanePaymentComponent
            prefill: '4026607986',
          },
        },
        styles: {
          root: {
            backgroundColorPrimary: '#ffffff',
          },
        },
      };

      // Update shipping address to match documentation format
      const shippingAddress = customerData?.shippingAddress || {
        firstName: 'Demo',
        lastName: 'Customer',
        company: 'Braintree',
        streetAddress: '123 Demo Street',
        extendedAddress: '',
        locality: 'San Francisco',
        region: 'CA', // must be sent in 2-letter format
        postalCode: '94105',
        countryCodeAlpha2: 'US',
        phoneNumber: '14155551212',
      };

      // Create the payment component following official pattern
      window.fastlanePaymentComponent =
        await fastlaneInstance.FastlanePaymentComponent({
          options,
          shippingAddress,
        });

      // Render the payment component
      await window.fastlanePaymentComponent.render('#payment-component');

      // Update the shipping component with address info
      const shippingComponent = document.getElementById('shipping-component');
      shippingComponent.innerHTML = `
        <div style="text-align: left; width: 100%;">
          <div style="margin-bottom: 10px;">
            <strong>Shipping Address ${
              isMemberExperience ? '(Pre-filled)' : ''
            }</strong>
          </div>
          <div style="color: #666; font-size: 14px;">
            ${shippingAddress.streetAddress}<br>
            ${shippingAddress.locality}, ${shippingAddress.region} ${
        shippingAddress.postalCode
      }<br>
            ${shippingAddress.countryCodeAlpha2}
          </div>
        </div>
      `;
      shippingComponent.classList.add('loaded');

      // Enable the Place Order button now that payment component is ready
      const placeOrderButton = document.getElementById('place-order');
      if (placeOrderButton) {
        placeOrderButton.disabled = false;
        console.log('Place Order button enabled');
      }

      console.log('Fastlane payment component rendered successfully');
    } catch (error) {
      console.error('Failed to render Fastlane payment component:', error);

      // Fallback to demo components
      simulateFastlaneComponents();

      // Still enable the button for demo mode
      const placeOrderButton = document.getElementById('place-order');
      if (placeOrderButton) {
        placeOrderButton.disabled = false;
        console.log('Place Order button enabled (demo mode)');
      }
    }
  }

  // Handle edit shipping
  function editShipping() {
    showResult('Opening shipping editor...', 'info');
    // In a real implementation, this would open Fastlane's shipping editor
    console.log('Would open Fastlane shipping editor');
  }

  // Handle edit payment
  function editPayment() {
    showResult('Opening payment method editor...', 'info');
    // In a real implementation, this would open Fastlane's payment editor
    console.log('Would open Fastlane payment editor');
  }

  // Handle place order
  async function handlePlaceOrder() {
    const placeOrderButton = document.getElementById('place-order');
    placeOrderButton.disabled = true;
    placeOrderButton.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <span>Processing order...</span>
            </div>
        `;

    try {
      let paymentToken = null;

      // Get payment token from Fastlane payment component following documentation
      if (
        window.fastlanePaymentComponent &&
        window.fastlanePaymentComponent.getPaymentToken
      ) {
        try {
          const { id } =
            await window.fastlanePaymentComponent.getPaymentToken();
          paymentToken = id;
          console.log('Fastlane payment token retrieved:', id);
        } catch (tokenError) {
          console.error('Failed to get Fastlane payment token:', tokenError);
          throw new Error(
            'Failed to process payment. Please check your payment information.'
          );
        }
      } else {
        console.warn(
          'Fastlane payment component not available, using fallback'
        );
        paymentToken = 'demo-fastlane-token-' + Date.now();
      }

      // Prepare payment data with Fastlane token
      const paymentData = {
        email: document.getElementById('email').value,
        amount: '35.99',
        deviceData: deviceData,
        paymentMethodNonce: paymentToken,
        customerData: customerData,
        fastlaneExperience: !isGuestUser,
        shippingAddress: customerData?.shippingAddress || {
          streetAddress: '123 Demo Street',
          locality: 'San Francisco',
          region: 'CA',
          postalCode: '94105',
          countryCodeAlpha2: 'US',
        },
      };

      console.log('Sending payment data:', paymentData);

      const response = await fetch('/api/sale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        showResult(
          `
                    <h4>✅ Payment Successful!</h4>
                    <p><strong>Transaction ID:</strong> ${
                      result.transaction?.id || 'demo-txn-' + Date.now()
                    }</p>
                    <p><strong>Amount:</strong> $${
                      result.transaction?.amount || '35.99'
                    }</p>
                    <p><strong>Payment Method:</strong> Fastlane (${
                      isGuestUser ? 'Guest' : 'Returning Customer'
                    })</p>
                    <p><strong>Status:</strong> ${
                      result.transaction?.status || 'submitted_for_settlement'
                    }</p>
                    ${
                      result.transaction
                        ? `<pre>${JSON.stringify(
                            result.transaction,
                            null,
                            2
                          )}</pre>`
                        : ''
                    }
                `,
          'success'
        );
      } else {
        throw new Error(result.message || 'Transaction failed');
      }
    } catch (error) {
      console.error('Payment error:', error);
      showResult(
        `
                <h4>❌ Payment Failed</h4>
                <p>Error: ${error.message}</p>
                <p>Please try again or contact support.</p>
            `,
        'error'
      );
    } finally {
      placeOrderButton.disabled = false;
      placeOrderButton.innerHTML = 'Place Order - $35.99';
    }
  }

  // Utility functions
  function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  function showResult(message, type) {
    const result = document.getElementById('result');
    result.className = `result ${type}`;
    result.innerHTML = message;
    result.style.display = 'block';

    // Auto-hide info messages after 3 seconds
    if (type === 'info') {
      setTimeout(() => {
        result.style.display = 'none';
      }, 3000);
    }
  }

  // Event listeners
  document
    .getElementById('continue-button')
    .addEventListener('click', handleEmailSubmit);
  document
    .getElementById('edit-shipping')
    .addEventListener('click', editShipping);
  document
    .getElementById('edit-payment')
    .addEventListener('click', editPayment);
  document
    .getElementById('place-order')
    .addEventListener('click', handlePlaceOrder);

  // Initialize the application
  try {
    await initializeBraintree();
    console.log('Fastlane checkout initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Fastlane:', error);
    showResult(
      'Error: Failed to initialize payment system. Please refresh the page.',
      'error'
    );
  }
});

// Add some demo interactivity
document.addEventListener('DOMContentLoaded', function () {
  // Add smooth scrolling for better UX
  document.documentElement.style.scrollBehavior = 'smooth';

  // Add loading state management
  const form = document.querySelector('.payment-form');

  // Show loading state during initialization
  setTimeout(() => {
    form.classList.remove('loading');
  }, 500);
});
