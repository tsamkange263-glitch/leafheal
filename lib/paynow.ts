import { supabase } from '@/lib/supabase';

// Supabase Edge Function URL for proxying Paynow requests (avoids CORS on web)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/paynow-initiate`;

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

/**
 * Parse URL-encoded response from Paynow into an object (used for poll responses)
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

/**
 * Validate a Zimbabwe phone number (07XXXXXXXX or 263XXXXXXXXX format)
 */
export function validateZimPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^07\d{8}$/.test(cleaned) || /^263\d{9}$/.test(cleaned);
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

/**
 * Generate a unique transaction reference
 */
export function generateTransactionRef(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `HERB-${timestamp}-${random}`;
}

/**
 * Get the current user's access token for authenticated edge function calls
 */
async function getAccessToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error('Authentication required. Please sign in and try again.');
  }
  return session.access_token;
}

/**
 * Call the Paynow edge function proxy to avoid CORS issues on web.
 * The edge function handles hash generation and Paynow communication server-side.
 */
async function callPaynowEdgeFunction(payload: Record<string, unknown>): Promise<PaynowResponse> {
  const accessToken = await getAccessToken();

  let response: Response;
  try {
    response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : 'Unknown network error';
    console.error('[paynow] Network error calling edge function:', msg);
    throw new Error(
      'Network error connecting to payment gateway. Please check your internet connection and try again.'
    );
  }

  let responseData: Record<string, unknown>;
  try {
    responseData = await response.json();
  } catch {
    const text = await response.text().catch(() => '');
    console.error('[paynow] Non-JSON response from edge function:', text);
    throw new Error(`Payment gateway returned an invalid response (HTTP ${response.status}). Please try again.`);
  }

  if (!response.ok) {
    const errorMsg = (responseData.error as string) || `Payment request failed (HTTP ${response.status})`;
    const details = (responseData.details as string) || '';
    console.error('[paynow] Edge function error:', { status: response.status, error: errorMsg, details });
    throw new Error(errorMsg + (details ? `: ${details}` : ''));
  }

  // Success response from edge function
  return {
    status: (responseData.status as string) || 'ok',
    browserurl: (responseData.browserurl as string) || undefined,
    pollurl: (responseData.pollurl as string) || undefined,
    hash: (responseData.hash as string) || undefined,
  };
}

/**
 * Send an EcoCash payment request via Paynow remote transaction API.
 * Proxied through Supabase Edge Function to avoid CORS issues.
 * Returns the parsed response containing pollurl on success.
 */
export async function sendEcoCashPayment(
  amount: number,
  phone: string,
  reference: string
): Promise<PaynowResponse> {
  const normalizedPhone = normalizePhone(phone);

  const result = await callPaynowEdgeFunction({
    type: 'ecocash',
    amount,
    reference,
    phone: normalizedPhone,
    method: 'ecocash',
  });

  if (!result.pollurl) {
    throw new Error('No poll URL returned from payment gateway.');
  }

  return result;
}

/**
 * Poll the transaction status from Paynow.
 * Returns the parsed poll response.
 */
export async function pollTransaction(pollUrl: string): Promise<PollResult> {
  const response = await fetch(pollUrl);

  if (!response.ok) {
    throw new Error(`Poll request failed with status ${response.status}`);
  }

  const responseText = await response.text();
  const parsed = parsePaynowResponse(responseText);

  return parsed as PollResult;
}

/**
 * Check if a poll result indicates payment was successful
 */
export function isPaymentPaid(result: PollResult): boolean {
  const status = result.status?.toLowerCase();
  return status === 'paid';
}

/**
 * Check if a poll result indicates payment is still pending
 */
export function isPaymentPending(result: PollResult): boolean {
  const status = result.status?.toLowerCase();
  return (
    status === 'sent' ||
    status === 'pending' ||
    status === 'created' ||
    status === 'awaiting delivery' ||
    status === 'delivered'
  );
}

/**
 * Check if a poll result indicates payment has failed/cancelled
 */
export function isPaymentFailed(result: PollResult): boolean {
  const status = result.status?.toLowerCase();
  return (
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'disputed' ||
    status === 'refunded'
  );
}

/**
 * Initiate a standard Paynow web checkout for Visa/Mastercard payments.
 * Proxied through Supabase Edge Function to avoid CORS issues on web.
 * Returns a browserurl where the user completes card payment, and a pollurl for status checks.
 */
export async function initiateCardPayment(
  amount: number,
  reference: string,
  _customerEmail?: string
): Promise<PaynowResponse> {
  const result = await callPaynowEdgeFunction({
    type: 'card',
    amount,
    reference,
  });

  if (!result.browserurl) {
    throw new Error('No checkout URL returned from payment gateway. Please try again.');
  }

  if (!result.pollurl) {
    throw new Error('No poll URL returned from payment gateway. Please try again.');
  }

  return result;
}
