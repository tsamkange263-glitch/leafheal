/**
 * StripeWebCheckout — Web-only modal overlay for Stripe card payments.
 * Listens for 'stripe-web-checkout' custom events and presents a
 * Payment Element form using @stripe/react-stripe-js.
 *
 * The Stripe publishable key is fetched dynamically from the Supabase
 * app_config table, allowing key rotation without app rebuild.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { resolveWebPaymentSheet } from '@/lib/stripe-web-payment-bridge';
import { getPricingConfig, getStripePublishableKey } from '@/lib/app-config';
import { extractErrorMessage } from '@/lib/error-utils';
import { Colors } from '@/constants/Colors';
import { Fonts } from '@/constants/Typography';

// Cache the Stripe instance per publishable key to avoid re-initializing
let stripePromise: Promise<Stripe | null> | null = null;
let cachedKeyForStripe: string | null = null;

function getStripe(publishableKey: string): Promise<Stripe | null> {
  // If key changed (e.g., test → live), reset and re-init
  if (cachedKeyForStripe !== publishableKey) {
    stripePromise = null;
    cachedKeyForStripe = publishableKey;
  }
  if (!stripePromise) {
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

/**
 * Inner checkout form that uses Stripe Elements hooks.
 */
function CheckoutForm({ onClose, priceLabel, scansLabel }: { onClose: () => void; priceLabel: string; scansLabel: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message || 'Validation failed. Please check your card details.');
        setLoading(false);
        return;
      }

      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (confirmError) {
        if (confirmError.type === 'card_error' || confirmError.type === 'validation_error') {
          setError(confirmError.message || 'Payment failed. Please try again.');
        } else {
          setError('An unexpected error occurred. Please try again.');
        }
        setLoading(false);
        return;
      }

      // Payment succeeded
      resolveWebPaymentSheet({ success: true });
      onClose();
    } catch (e: unknown) {
      const message = extractErrorMessage(e, 'Payment failed. Please try again.');
      setError(message);
      setLoading(false);
    }
  };

  const handleCancel = () => {
    resolveWebPaymentSheet({ success: false, cancelled: true });
    onClose();
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      {/* Backdrop */}
      <Pressable
        onPress={handleCancel}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
        }}
      />

      {/* Card */}
      <View
        style={{
          backgroundColor: Colors.white,
          borderRadius: 24,
          borderCurve: 'continuous',
          width: '92%',
          maxWidth: 440,
          padding: 28,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          zIndex: 10,
        }}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <View style={{ gap: 2 }}>
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 20,
                color: Colors.textPrimary,
              }}
            >
              Card Payment
            </Text>
            <Text
              style={{
                fontFamily: Fonts.regular,
                fontSize: 13,
                color: Colors.textSecondary,
              }}
            >
              {priceLabel} USD — {scansLabel} Plant Scans
            </Text>
          </View>
          <Pressable
            onPress={handleCancel}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: Colors.background,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 18, color: Colors.textSecondary, lineHeight: 20 }}>✕</Text>
          </Pressable>
        </View>

        {/* Stripe Payment Element */}
        <View style={{ minHeight: 200, marginBottom: 20 }}>
          <PaymentElement
            onReady={() => setReady(true)}
            options={{
              layout: 'tabs',
            }}
          />
          {!ready && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={{ fontFamily: Fonts.regular, fontSize: 13, color: Colors.textSecondary, marginTop: 8 }}>
                Loading payment form...
              </Text>
            </View>
          )}
        </View>

        {/* Error message */}
        {error && (
          <View
            style={{
              backgroundColor: 'rgba(211,47,47,0.08)',
              borderRadius: 12,
              borderCurve: 'continuous',
              padding: 12,
              marginBottom: 16,
            }}
          >
            <Text
              selectable
              style={{
                fontFamily: Fonts.regular,
                fontSize: 13,
                color: Colors.error,
                lineHeight: 19,
              }}
            >
              {error}
            </Text>
          </View>
        )}

        {/* Pay Button */}
        <Pressable
          onPress={handleSubmit}
          disabled={loading || !ready || !stripe}
          style={({ pressed }) => ({
            backgroundColor: '#635BFF',
            paddingVertical: 16,
            borderRadius: 14,
            borderCurve: 'continuous',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: (loading || !ready || !stripe) ? 0.6 : pressed ? 0.9 : 1,
          })}
        >
          {loading ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: 16,
                color: Colors.white,
              }}
            >
              Pay {priceLabel}
            </Text>
          )}
        </Pressable>

        {/* Security badge */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 }}>
          <Text style={{ fontSize: 12, color: Colors.textLight }}>🔒</Text>
          <Text
            style={{
              fontFamily: Fonts.regular,
              fontSize: 11,
              color: Colors.textLight,
            }}
          >
            Secured by Stripe
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Main component that mounts at app root level.
 * Listens for custom events and shows the checkout modal.
 * Fetches the Stripe publishable key dynamically from Supabase on mount.
 */
export function StripeWebCheckout() {
  const [visible, setVisible] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [priceLabel, setPriceLabel] = useState('$1.25');
  const [scansLabel, setScansLabel] = useState('15');
  const [publishableKey, setPublishableKey] = useState(
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
  );
  const keyFetchedRef = useRef(false);

  // Fetch the dynamic publishable key on mount
  useEffect(() => {
    if (keyFetchedRef.current) return;
    keyFetchedRef.current = true;

    async function fetchKey() {
      try {
        const key = await getStripePublishableKey();
        if (key) {
          setPublishableKey(key);
        }
      } catch (err) {
        console.warn('[stripe-web-checkout] Failed to fetch dynamic key, using env fallback:', err);
      }
    }
    fetchKey();
  }, []);

  const handleOpen = useCallback(async (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.clientSecret) {
      setClientSecret(detail.clientSecret);
      setVisible(true);
      // Fetch latest pricing for display
      try {
        const pricing = await getPricingConfig();
        setPriceLabel(`$${pricing.price_usd.toFixed(2)}`);
        setScansLabel(String(pricing.scan_quantity));
      } catch {
        // Keep defaults
      }
    }
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    setClientSecret(null);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('stripe-web-checkout', handleOpen);
      return () => window.removeEventListener('stripe-web-checkout', handleOpen);
    }
  }, [handleOpen]);

  if (!visible || !clientSecret || !publishableKey) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        resolveWebPaymentSheet({ success: false, cancelled: true });
        handleClose();
      }}
    >
      <Elements
        stripe={getStripe(publishableKey)}
        options={{
          clientSecret,
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: '#635BFF',
              borderRadius: '10px',
              fontFamily: 'Nunito, system-ui, sans-serif',
            },
          },
        }}
      >
        <CheckoutForm onClose={handleClose} priceLabel={priceLabel} scansLabel={scansLabel} />
      </Elements>
    </Modal>
  );
}
