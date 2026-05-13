/**
 * Web Stripe Provider — renders children with the StripeWebCheckout overlay.
 * The overlay listens for payment sheet open events and presents a
 * Stripe Elements form in a modal.
 */
import { type ReactNode } from 'react';
import { StripeWebCheckout } from '@/components/stripe-web-checkout';

interface StripeProviderWrapperProps {
  children: ReactNode;
}

export function StripeProviderWrapper({ children }: StripeProviderWrapperProps) {
  return (
    <>
      {children}
      <StripeWebCheckout />
    </>
  );
}
