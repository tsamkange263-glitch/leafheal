import { supabase } from '@/lib/supabase';

export interface PaymentConfig {
  paynow_integration_id: string;
  paynow_integration_key: string;
  paynow_amount: string;
  paynow_ecocash_amount: string;
  paynow_result_url: string;
  paynow_return_url: string;
  paynow_auth_email: string;
  scans_per_payment: number;
}

// Default fallback values (used if database fetch fails)
const DEFAULT_CONFIG: PaymentConfig = {
  paynow_integration_id: '24565',
  paynow_integration_key: '',
  paynow_amount: '1.25',
  paynow_ecocash_amount: '1.00',
  paynow_result_url: '',
  paynow_return_url: 'https://www.paynow.co.zw',
  paynow_auth_email: '',
  scans_per_payment: 20,
};

const CONFIG_KEYS = [
  'paynow_integration_id',
  'paynow_integration_key',
  'paynow_amount',
  'paynow_ecocash_amount',
  'paynow_result_url',
  'paynow_return_url',
  'paynow_auth_email',
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
      paynow_integration_key: configMap.paynow_integration_key ?? DEFAULT_CONFIG.paynow_integration_key,
      paynow_amount: configMap.paynow_amount ?? DEFAULT_CONFIG.paynow_amount,
      paynow_ecocash_amount: configMap.paynow_ecocash_amount ?? DEFAULT_CONFIG.paynow_ecocash_amount,
      paynow_result_url: configMap.paynow_result_url ?? DEFAULT_CONFIG.paynow_result_url,
      paynow_return_url: configMap.paynow_return_url ?? DEFAULT_CONFIG.paynow_return_url,
      paynow_auth_email: configMap.paynow_auth_email ?? DEFAULT_CONFIG.paynow_auth_email,
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
