/**
 * Platform-aware Stripe Provider.
 * On native (iOS/Android), wraps children in StripeProvider from @stripe/stripe-react-native.
 * On web, renders children directly (Stripe RN SDK doesn't support web).
 */

import { ReactNode } from 'react';
import { Platform } from 'react-native';

interface StripeProviderWrapperProps {
  children: ReactNode;
}

function StripeProviderNative({ children }: StripeProviderWrapperProps) {
  // Dynamic require is necessary here to avoid web bundling issues
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { StripeProvider } = require('@stripe/stripe-react-native');
  const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

  return (
    <StripeProvider
      publishableKey={publishableKey}
      merchantIdentifier="merchant.com.herbscan"
    >
      {children}
    </StripeProvider>
  );
}

function StripeProviderWeb({ children }: StripeProviderWrapperProps) {
  return <>{children}</>;
}

export const StripeProviderWrapper = Platform.OS === 'web'
  ? StripeProviderWeb
  : StripeProviderNative;
