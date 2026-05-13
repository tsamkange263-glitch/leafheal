/**
 * Web Stripe Provider — renders children directly since
 * @stripe/stripe-react-native is native-only.
 */
import { ReactNode } from 'react';

interface StripeProviderWrapperProps {
  children: ReactNode;
}

export function StripeProviderWrapper({ children }: StripeProviderWrapperProps) {
  return <>{children}</>;
}
