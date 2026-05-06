import { supabase } from '@/lib/supabase';
import type { PaymentConfig } from '@/lib/app-config';

// =============================================================================
// EcoCash Direct Payment (Truckit proven implementation)
// Makes requests DIRECTLY from client to Paynow - no Edge Function proxy
// =============================================================================

const PAYNOW_REMOTE_TRANSACTION_URL = 'https://www.paynow.co.zw/interface/remotetransaction';

// Paynow EcoCash credentials (Truckit working config)
const INTEGRATION_ID = '14960';
const INTEGRATION_KEY = 'e2cfa088-d2a6-4f73-9c7a-b9f840cd26ce';
const MERCHANT_EMAIL = 'samkangineer@gmail.com';

// Paynow Advanced Payment Button base URL (for card payments only)
const PAYNOW_BUTTON_BASE_URL = 'https://www.paynow.co.zw/Payment/BillPaymentLink';

export interface PaynowResponse {
  status: string;
  browserurl?: string;
  pollurl?: string;
  hash?: string;
  error?: string;
  [key: string]: string | undefined;
}

export interface PollResult {
  status: string;
  amount?: string;
  reference?: string;
  paynowreference?: string;
  hash?: string;
  [key: string]: string | undefined;
}

// =============================================================================
// SHA-512 Hash Generation (Paynow API requirement)
// =============================================================================

/**
 * Generate SHA-512 hash for Paynow API authentication.
 * Concatenates all field values in order + integration key, then hashes.
 */
async function generateHash(values: string[], integrationKey: string): Promise<string> {
  const concatenated = values.join('') + integrationKey;

  // Use Web Crypto API (works in both browser and React Native with hermes)
  const encoder = new TextEncoder();
  const data = encoder.encode(concatenated);
  const hashBuffer = await crypto.subtle.digest('SHA-512', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex.toUpperCase();
}

// =============================================================================
// Phone Validation (Zimbabwe EcoCash numbers)
// =============================================================================

/**
 * Validate a Zimbabwe EcoCash phone number.
 * Accepts: 077XXXXXXX, 078XXXXXXX, 2637XXXXXXXX formats
 */
export function validateZimPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  // Local format: 07X followed by 8 digits (specifically 077 or 078 for EcoCash)
  if (/^07[78]\d{7}$/.test(cleaned)) return true;
  // International format: 2637X followed by 7 digits
  if (/^2637[78]\d{7}$/.test(cleaned)) return true;
  return false;
}

/**
 * Normalize phone number to 263XXXXXXXXX format for Paynow
 */
export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('07')) {
    return '263' + cleaned.substring(1);
  }
  if (cleaned.startsWith('263')) {
    return cleaned;
  }
  return cleaned;
}

// =============================================================================
// Transaction Reference Generation (Truckit format)
// =============================================================================

/**
 * Generate a unique transaction reference in Truckit format.
 * Format: CUSTOMERNAME (alphanumeric, first 10 chars, uppercase) + timestamp (YYYYMMDDHHmmss)
 * Example: "JOHN20260420143022"
 */
export function generateTransactionRef(customerName: string): string {
  // Take alphanumeric only, first 10 chars, uppercase
  const cleanName = customerName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();

  // Generate timestamp in YYYYMMDDHHmmss format (no separators)
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;

  return `${cleanName}${timestamp}`;
}

// =============================================================================
// EcoCash Direct Payment (Client-to-Paynow, no Edge Function)
// =============================================================================

/**
 * Send an EcoCash payment request DIRECTLY to Paynow's remote transaction API.
 * This is the Truckit proven approach - direct client POST, no server proxy.
 *
 * @param phone - Customer's EcoCash number (will be normalized to 263 format)
 * @param reference - Unique transaction reference (from generateTransactionRef)
 * @param paymentAmount - Payment amount in USD (from app_config paynow_amount)
 * @returns { success: true, pollUrl } or { success: false, error }
 */
export async function sendEcoCashPayment(
  phone: string,
  reference: string,
  paymentAmount: number
): Promise<{ success: boolean; pollUrl?: string; error?: string }> {
  const normalizedPhone = normalizePhone(phone);
  const amount = paymentAmount.toFixed(2);
  const additionalInfo = 'HerbScan Plant ID Credits';
  const returnUrl = 'https://www.google.com';
  const resultUrl = 'https://www.google.com';
  const status = 'Message';
  const method = 'ecocash';

  // Generate SHA-512 hash: concatenate all values in order + integration key
  // Order: id, reference, amount, additionalinfo, returnurl, resulturl, authemail, phone, method, status
  const hashValues = [
    INTEGRATION_ID,
    reference,
    amount,
    additionalInfo,
    returnUrl,
    resultUrl,
    MERCHANT_EMAIL,
    normalizedPhone,
    method,
    status,
  ];

  let hash: string;
  try {
    hash = await generateHash(hashValues, INTEGRATION_KEY);
  } catch (err) {
    console.error('[paynow] Hash generation failed:', err);
    return { success: false, error: 'Failed to generate payment hash. Please try again.' };
  }

  // Build form-encoded POST body
  const formData = new URLSearchParams();
  formData.append('id', INTEGRATION_ID);
  formData.append('reference', reference);
  formData.append('amount', amount);
  formData.append('additionalinfo', additionalInfo);
  formData.append('returnurl', returnUrl);
  formData.append('resulturl', resultUrl);
  formData.append('authemail', MERCHANT_EMAIL);
  formData.append('phone', normalizedPhone);
  formData.append('method', method);
  formData.append('status', status);
  formData.append('hash', hash);

  console.log('[paynow] Sending EcoCash payment directly to Paynow...', {
    reference,
    phone: normalizedPhone,
    amount,
  });

  try {
    const response = await fetch(PAYNOW_REMOTE_TRANSACTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`[paynow] HTTP ${response.status}: ${errorText}`);
      return {
        success: false,
        error: `Payment gateway returned an error (HTTP ${response.status}). Please try again.`,
      };
    }

    const responseText = await response.text();
    console.log('[paynow] Paynow response:', responseText);

    const parsed = parsePaynowResponse(responseText);

    if (parsed.status?.toLowerCase() === 'error') {
      return {
        success: false,
        error: parsed.error || 'Payment initiation failed. Please try again.',
      };
    }

    if (!parsed.pollurl) {
      return {
        success: false,
        error: 'No poll URL returned from payment gateway. Please try again.',
      };
    }

    return { success: true, pollUrl: parsed.pollurl };
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : 'Unknown network error';
    console.error('[paynow] Network error:', msg);
    return {
      success: false,
      error: 'Network error connecting to payment gateway. Please check your internet connection and try again.',
    };
  }
}

// =============================================================================
// Poll Transaction Status
// =============================================================================

/**
 * Poll the transaction status from Paynow.
 * Returns the parsed poll response with status field.
 */
export async function pollTransaction(pollUrl: string): Promise<PollResult> {
  const response = await fetch(pollUrl);

  if (!response.ok) {
    throw new Error(`Poll request failed with status ${response.status}`);
  }

  const responseText = await response.text();
  const parsed = parsePaynowResponse(responseText);

  console.log('[paynow] Poll result status:', parsed.status);
  return parsed as PollResult;
}

/**
 * Check if a poll result indicates payment was successful.
 * Paynow status: "Paid"
 */
export function isPaymentPaid(result: PollResult): boolean {
  const status = result.status?.toLowerCase();
  return status === 'paid';
}

/**
 * Check if a poll result indicates payment is still pending/in-progress.
 * These statuses mean the USSD push is sent but user hasn't completed or cancelled yet.
 *
 * Paynow statuses handled:
 * - "sent" — USSD push sent to phone
 * - "pending" — waiting for user action
 * - "created" — transaction created
 * - "awaiting delivery" — being processed
 * - "delivered" — USSD delivered, waiting for PIN
 * - "awaiting payment" — USSD prompt displayed, waiting for user to enter PIN
 */
export function isPaymentPending(result: PollResult): boolean {
  const status = result.status?.toLowerCase();
  return (
    status === 'sent' ||
    status === 'pending' ||
    status === 'created' ||
    status === 'awaiting delivery' ||
    status === 'delivered' ||
    status === 'awaiting payment'
  );
}

/**
 * Check if a poll result indicates payment was cancelled by the user.
 * Paynow status: "Cancelled" — user dismissed the USSD prompt or actively cancelled.
 */
export function isPaymentCancelled(result: PollResult): boolean {
  const status = result.status?.toLowerCase();
  return status === 'cancelled';
}

/**
 * Check if a poll result indicates payment has definitively failed.
 * Covers all terminal failure states from Paynow:
 * - "failed" — payment processing failed
 * - "cancelled" — user cancelled the USSD prompt
 * - "disputed" — transaction disputed
 * - "refunded" — transaction refunded
 * - "timed out" — user did not respond to USSD prompt in time
 */
export function isPaymentFailed(result: PollResult): boolean {
  const status = result.status?.toLowerCase();
  return (
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'disputed' ||
    status === 'refunded' ||
    status === 'timed out'
  );
}

/**
 * Check if a poll result indicates payment timed out (user ignored USSD prompt).
 * Paynow status: "Timed out"
 */
export function isPaymentTimedOut(result: PollResult): boolean {
  const status = result.status?.toLowerCase();
  return status === 'timed out';
}

/**
 * Get a user-friendly error message based on the Paynow status.
 */
export function getPaymentFailureMessage(result: PollResult): string {
  const status = result.status?.toLowerCase();
  switch (status) {
    case 'cancelled':
      return 'Payment was cancelled. You dismissed the EcoCash prompt on your phone. Please try again when ready.';
    case 'timed out':
      return 'Payment timed out. You did not respond to the EcoCash prompt on your phone. Please try again.';
    case 'failed':
      return 'Payment failed. This could be due to insufficient balance or a network issue. Please try again.';
    case 'disputed':
      return 'Payment was disputed. Please contact support if you believe this is an error.';
    case 'refunded':
      return 'Payment was refunded. Please try again or contact support.';
    default:
      return `Payment was not completed (status: ${result.status || 'unknown'}). Please try again.`;
  }
}

// =============================================================================
// Card Payment (Visa/Mastercard) - Unchanged, separate flow
// =============================================================================

/**
 * Build a dynamic Paynow Advanced Payment Button checkout URL for card payments.
 * Uses integration ID and amount from the app_config table (passed in as config).
 */
export function buildPaynowCheckoutUrl(
  userReference: string,
  config: PaymentConfig,
  userEmail?: string
): string {
  const args = `id=${config.paynow_integration_id}&amount=${config.paynow_amount}&f1=${encodeURIComponent(userReference)}&l=1`;
  const base64Encoded = btoa(args);
  const urlSafeBase64 = encodeURIComponent(base64Encoded);

  if (userEmail) {
    return `${PAYNOW_BUTTON_BASE_URL}/${encodeURIComponent(userEmail)}?q=${urlSafeBase64}`;
  }
  return `${PAYNOW_BUTTON_BASE_URL}/?q=${urlSafeBase64}`;
}

/**
 * Generate a unique payment reference for the Paynow custom field (f1) - card payments only.
 * Format: HERBSCAN-{userId}-{timestamp}
 */
export function generatePaymentReference(userId: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const userShort = userId.replace(/-/g, '').substring(0, 12);
  return `HERBSCAN-${userShort}-${timestamp}`;
}

/**
 * Check payment status by querying the payments table directly.
 * Used for card payments where webhook updates the DB.
 */
export async function checkPaymentStatusFromDB(paymentId: string): Promise<string> {
  const { data, error } = await supabase
    .from('payments')
    .select('status')
    .eq('id', paymentId)
    .single();

  if (error) {
    throw new Error('Failed to check payment status. Please try again.');
  }

  return data?.status || 'pending';
}

// =============================================================================
// Configuration re-export
// =============================================================================

export { getPaymentConfig, type PaymentConfig } from '@/lib/app-config';

// =============================================================================
// Utilities
// =============================================================================

/**
 * Parse URL-encoded response from Paynow into an object
 */
function parsePaynowResponse(responseText: string): PaynowResponse {
  const params: Record<string, string> = {};
  const pairs = responseText.split('&');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex > -1) {
      const key = decodeURIComponent(pair.substring(0, eqIndex)).toLowerCase();
      const value = decodeURIComponent(pair.substring(eqIndex + 1));
      params[key] = value;
    }
  }
  return params as PaynowResponse;
}
