/**
 * Native implementation of the Stripe Payment Sheet.
 * Uses @stripe/stripe-react-native which is only available on iOS/Android.
 */
import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';

export interface PaymentSheetResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}

export async function openPaymentSheet(clientSecret: string): Promise<PaymentSheetResult> {
  if (!clientSecret) {
    return {
      success: false,
      error: 'Payment setup failed — no client secret provided. Please try again.',
    };
  }

  try {
    const { error: initError } = await initPaymentSheet({
      paymentIntentClientSecret: clientSecret,
      merchantDisplayName: 'HerbScan',
      allowsDelayedPaymentMethods: false,
      googlePay: {
        merchantCountryCode: 'US',
        testEnv: __DEV__,
      },
      applePay: {
        merchantCountryCode: 'US',
      },
    });

    if (initError) {
      console.error('[stripe] PaymentSheet init error:', initError.code, initError.message);
      return {
        success: false,
        error: initError.message || 'Failed to initialize payment. Please try again.',
      };
    }

    const { error: presentError } = await presentPaymentSheet();

    if (presentError) {
      if (presentError.code === 'Canceled') {
        return { success: false, cancelled: true };
      }
      console.error('[stripe] PaymentSheet present error:', presentError.code, presentError.message);
      return {
        success: false,
        error: presentError.message || 'Payment failed. Please check your card details and try again.',
      };
    }

    return { success: true };
  } catch (e: unknown) {
    // Catch unexpected errors from the Stripe SDK
    const message =
      e instanceof Error
        ? e.message
        : typeof e === 'object' && e !== null && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'An unexpected payment error occurred. Please try again.';
    console.error('[stripe] Unexpected PaymentSheet error:', message);
    return {
      success: false,
      error: message,
    };
  }
}
