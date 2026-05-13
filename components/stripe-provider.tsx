/**
 * Native Stripe Provider — wraps children in StripeProvider from @stripe/stripe-react-native.
 * On web, Metro resolves to stripe-provider.web.tsx instead (which is a no-op wrapper).
 *
 * The publishable key is fetched dynamically from the Supabase app_config table,
 * allowing key rotation (test→live) without rebuilding the app.
 */
import { type ReactNode, useState, useEffect } from 'react';
import { StripeProvider } from '@stripe/stripe-react-native';
import { View } from 'react-native';
import { getStripePublishableKey } from '@/lib/app-config';

interface StripeProviderWrapperProps {
  children: ReactNode;
}

export function StripeProviderWrapper({ children }: StripeProviderWrapperProps) {
  const [publishableKey, setPublishableKey] = useState(
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
  );

  useEffect(() => {
    let cancelled = false;
    async function fetchKey() {
      try {
        const key = await getStripePublishableKey();
        if (!cancelled && key) {
          setPublishableKey(key);
        }
      } catch (err) {
        console.warn('[stripe-provider] Failed to fetch dynamic key, using env fallback:', err);
      }
    }
    fetchKey();
    return () => { cancelled = true; };
  }, []);

  return (
    <StripeProvider
      publishableKey={publishableKey}
      merchantIdentifier="merchant.com.herbscan"
    >
      <View style={{ flex: 1 }}>{children}</View>
    </StripeProvider>
  );
}
