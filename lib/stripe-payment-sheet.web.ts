/**
 * Web implementation of Stripe Payment Sheet.
 * Uses a global event-based approach: opens a modal payment form overlay
 * powered by @stripe/react-stripe-js Elements.
 *
 * The actual UI is rendered by the StripeWebCheckout component (mounted in
 * the web Stripe provider). This module just triggers it and awaits the result.
 */

import { setPaymentSheetResolver } from '@/lib/stripe-web-payment-bridge';

export interface PaymentSheetResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}

/**
 * Opens the web payment form by dispatching a custom event with the clientSecret.
 * Returns a promise that resolves when the user completes or cancels payment.
 */
export async function openPaymentSheet(clientSecret: string): Promise<PaymentSheetResult> {
  if (!clientSecret) {
    return {
      success: false,
      error: 'Payment setup failed — no client secret provided. Please try again.',
    };
  }

  return new Promise<PaymentSheetResult>((resolve) => {
    setPaymentSheetResolver(resolve);

    // Dispatch event to trigger the web checkout overlay
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('stripe-web-checkout', {
        detail: { clientSecret },
      });
      window.dispatchEvent(event);
    } else {
      resolve({
        success: false,
        error: 'Payment UI is not available in this environment.',
      });
    }
  });
}
