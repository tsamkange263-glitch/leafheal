/**
 * Web stub for Stripe Payment Sheet.
 * The native Payment Sheet is not available on web.
 * Returns a failure message directing users to use EcoCash or the mobile app.
 */

export interface PaymentSheetResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}

export async function openPaymentSheet(_clientSecret: string): Promise<PaymentSheetResult> {
  return {
    success: false,
    error: 'Card payments are only available on the mobile app. Please use EcoCash on web, or download the app for card payments.',
  };
}
