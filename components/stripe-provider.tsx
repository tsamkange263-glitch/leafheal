/**
 * Native Stripe Provider — wraps children in StripeProvider from @stripe/stripe-react-native.
 * On web, Metro resolves to stripe-provider.web.tsx instead (which is a no-op wrapper).
 */
import { type ReactNode } from 'react';
import { StripeProvider } from '@stripe/stripe-react-native';
import { View } from 'react-native';

interface StripeProviderWrapperProps {
  children: ReactNode;
}

export function StripeProviderWrapper({ children }: StripeProviderWrapperProps) {
  const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

  return (
    <StripeProvider
      publishableKey={publishableKey}
      merchantIdentifier="merchant.com.herbscan"
    >
      <View style={{ flex: 1 }}>{children}</View>
    </StripeProvider>
  );
}
