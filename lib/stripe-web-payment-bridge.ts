/**
 * Bridge module for web Stripe payment sheet communication.
 * Provides event-based communication between the payment sheet opener
 * (stripe-payment-sheet.web.ts) and the checkout UI (stripe-web-checkout.tsx).
 */

export interface PaymentSheetResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}

type PaymentSheetResolver = (result: PaymentSheetResult) => void;

let currentResolver: PaymentSheetResolver | null = null;

/**
 * Called by the StripeWebCheckout component when payment completes or is cancelled.
 */
export function resolveWebPaymentSheet(result: PaymentSheetResult): void {
  if (currentResolver) {
    currentResolver(result);
    currentResolver = null;
  }
}

/**
 * Sets the resolver for the current payment sheet session.
 */
export function setPaymentSheetResolver(resolver: PaymentSheetResolver): void {
  currentResolver = resolver;
}
