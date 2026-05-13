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
    return {
      success: false,
      error: presentError.message || 'Payment failed. Please try again.',
    };
  }

  return { success: true };
}
