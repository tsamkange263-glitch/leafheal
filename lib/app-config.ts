import { supabase } from '@/lib/supabase';

export interface PaymentConfig {
  paynow_integration_id: string;
  paynow_amount: string;
  paynow_ecocash_amount: string;
  scans_per_payment: number;
}

export interface PricingConfig {
  price_usd: number;
  scan_quantity: number;
  currency: string;
}

// Default fallback values (used if database fetch fails)
const DEFAULT_CONFIG: PaymentConfig = {
  paynow_integration_id: '24565',
  paynow_amount: '1.25',
  paynow_ecocash_amount: '1.25',
  scans_per_payment: 15,
};

// Default pricing fallback
const DEFAULT_PRICING: PricingConfig = {
  price_usd: 1.25,
  scan_quantity: 15,
  currency: 'USD',
};

const CONFIG_KEYS = [
  'paynow_integration_id',
  'paynow_amount',
  'paynow_ecocash_amount',
  'scans_per_payment',
];

// Simple in-memory cache with TTL
let cachedConfig: PaymentConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all payment configuration values from the app_config table.
 * Uses a short-lived cache to avoid redundant DB calls during a single session.
 * Falls back to hardcoded defaults if the fetch fails.
 */
export async function getPaymentConfig(): Promise<PaymentConfig> {
  const now = Date.now();

  // Return cached config if still fresh
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', CONFIG_KEYS);

    if (error) {
      console.error('[app-config] Failed to fetch config:', error.message);
      return cachedConfig ?? DEFAULT_CONFIG;
    }

    if (!data || data.length === 0) {
      console.warn('[app-config] No config rows found, using defaults');
      return cachedConfig ?? DEFAULT_CONFIG;
    }

    const configMap: Record<string, string> = {};
    for (const row of data) {
      configMap[row.key] = row.value;
    }

    const config: PaymentConfig = {
      paynow_integration_id: configMap.paynow_integration_id ?? DEFAULT_CONFIG.paynow_integration_id,
      paynow_amount: configMap.paynow_amount ?? DEFAULT_CONFIG.paynow_amount,
      paynow_ecocash_amount: configMap.paynow_ecocash_amount ?? configMap.paynow_amount ?? DEFAULT_CONFIG.paynow_ecocash_amount,
      scans_per_payment: parseInt(configMap.scans_per_payment ?? String(DEFAULT_CONFIG.scans_per_payment), 10),
    };

    // Validate scans_per_payment is a positive number
    if (isNaN(config.scans_per_payment) || config.scans_per_payment <= 0) {
      config.scans_per_payment = DEFAULT_CONFIG.scans_per_payment;
    }

    cachedConfig = config;
    cacheTimestamp = now;

    return config;
  } catch (err) {
    console.error('[app-config] Unexpected error fetching config:', err);
    return cachedConfig ?? DEFAULT_CONFIG;
  }
}

/**
 * Invalidate the cached config, forcing a fresh fetch on next call.
 */
export function invalidateConfigCache(): void {
  cachedConfig = null;
  cacheTimestamp = 0;
  cachedPricing = null;
  pricingCacheTimestamp = 0;
  cachedStripePublishableKey = null;
  stripeKeyCacheTimestamp = 0;
}

// Pricing config cache
let cachedPricing: PricingConfig | null = null;
let pricingCacheTimestamp = 0;

/**
 * Fetch the active pricing configuration from the pricing_config table.
 * Returns the current price and scan quantity for purchases.
 * Falls back to hardcoded defaults if the fetch fails.
 */
export async function getPricingConfig(): Promise<PricingConfig> {
  const now = Date.now();

  // Return cached pricing if still fresh
  if (cachedPricing && now - pricingCacheTimestamp < CACHE_TTL_MS) {
    return cachedPricing;
  }

  try {
    const { data, error } = await supabase
      .from('pricing_config')
      .select('price_usd, scan_quantity, currency')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error('[app-config] Failed to fetch pricing config:', error.message);
      return cachedPricing ?? DEFAULT_PRICING;
    }

    if (!data) {
      console.warn('[app-config] No active pricing config found, using defaults');
      return cachedPricing ?? DEFAULT_PRICING;
    }

    const pricing: PricingConfig = {
      price_usd: parseFloat(String(data.price_usd)),
      scan_quantity: data.scan_quantity,
      currency: data.currency || 'USD',
    };

    // Validate values
    if (isNaN(pricing.price_usd) || pricing.price_usd <= 0) {
      pricing.price_usd = DEFAULT_PRICING.price_usd;
    }
    if (!pricing.scan_quantity || pricing.scan_quantity <= 0) {
      pricing.scan_quantity = DEFAULT_PRICING.scan_quantity;
    }

    cachedPricing = pricing;
    pricingCacheTimestamp = now;

    return pricing;
  } catch (err) {
    console.error('[app-config] Unexpected error fetching pricing config:', err);
    return cachedPricing ?? DEFAULT_PRICING;
  }
}

/**
 * Fetch a single config value by key.
 * Useful for specific lookups without fetching all payment config.
 */
export async function getConfigValue(key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', key)
      .single();

    if (error || !data) {
      console.error(`[app-config] Failed to fetch key "${key}":`, error?.message);
      return null;
    }

    return data.value;
  } catch (err) {
    console.error(`[app-config] Unexpected error fetching key "${key}":`, err);
    return null;
  }
}

// =========================================================================
// Stripe Publishable Key — fetched from DB with cache + env fallback
// =========================================================================

let cachedStripePublishableKey: string | null = null;
let stripeKeyCacheTimestamp = 0;

/**
 * Fetch the Stripe publishable key from the app_config table.
 * This allows switching between test/live keys without rebuilding the app.
 * Falls back to EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY env variable if DB fetch fails.
 */
export async function getStripePublishableKey(): Promise<string> {
  const now = Date.now();

  // Return cached key if still fresh
  if (cachedStripePublishableKey && now - stripeKeyCacheTimestamp < CACHE_TTL_MS) {
    return cachedStripePublishableKey;
  }

  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'stripe_publishable_key')
      .single();

    if (error || !data?.value) {
      console.warn(
        '[app-config] Failed to fetch stripe_publishable_key from DB, using env fallback:',
        error?.message
      );
      return getStripePublishableKeyFallback();
    }

    // Validate the key format (should start with pk_test_ or pk_live_)
    const key = data.value.trim();
    if (!key.startsWith('pk_test_') && !key.startsWith('pk_live_')) {
      console.warn('[app-config] Invalid stripe publishable key format in DB, using env fallback');
      return getStripePublishableKeyFallback();
    }

    cachedStripePublishableKey = key;
    stripeKeyCacheTimestamp = now;

    return key;
  } catch (err) {
    console.error('[app-config] Unexpected error fetching Stripe publishable key:', err);
    return getStripePublishableKeyFallback();
  }
}

function getStripePublishableKeyFallback(): string {
  const envKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
  if (envKey) {
    cachedStripePublishableKey = envKey;
    stripeKeyCacheTimestamp = Date.now();
  }
  return envKey;
}
