import { supabase } from '@/lib/supabase';
import type { PaymentConfig } from '@/lib/app-config';

// Supabase Edge Function URL for proxying Paynow requests
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/paynow-initiate`;

// Paynow direct API URL (used for client-side card payment initiation)
const PAYNOW_INITIATE_URL = 'https://www.paynow.co.zw/interface/initiatetransaction';

// Paynow Advanced Payment Button base URL (static)
const PAYNOW_BUTTON_BASE_URL = 'https://www.paynow.co.zw/Payment/BillPaymentLink';

export interface PaynowResponse {
  status: string;
  browserurl?: string;
  pollurl?: string;
  hash?: string;
  error?: string;
  [key: string]: string | undefined;
}

export interface CardPaymentHashResponse {
  status: string;
  hash: string;
  integration_id: string;
  amount: string;
  additionalinfo: string;
  returnurl: string;
  resulturl: string;
  cancelurl: string;
  authemail: string;
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
 * Generate a unique transaction reference.
 * If userId is provided, embeds a short user identifier for payment matching.
 */
export function generateTransactionRef(userId?: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  if (userId) {
    // Include first 8 chars of user ID for traceability
    const userShort = userId.replace(/-/g, '').substring(0, 8).toUpperCase();
    return `HERBSCAN-${userShort}-${timestamp}-${random}`;
  }
  return `HERB-${timestamp}-${random}`;
}

/**
 * Build a dynamic Paynow Advanced Payment Button checkout URL.
 *
 * Uses integration ID and amount from the app_config table (passed in as config).
 * Encodes the integration ID, amount, and a custom field (f1) containing
 * a unique user reference (e.g. HERBSCAN-userId-timestamp) for reliable
 * payment-to-user matching in the webhook notification.
 *
 * Encoding process (matches Paynow's expected format):
 * 1. Construct arguments string with URL-encoded field values
 * 2. Base64 encode the entire arguments string
 * 3. URL-encode the Base64 result (replace +, /, = with URL-safe equivalents)
 */
export function buildPaynowCheckoutUrl(
  userReference: string,
  config: PaymentConfig,
  userEmail?: string
): string {
  // Construct the arguments string with the custom field f1 using dynamic config
  const args = `id=${config.paynow_integration_id}&amount=${config.paynow_amount}&f1=${encodeURIComponent(userReference)}&l=1`;

  // Base64 encode the arguments string
  const base64Encoded = btoa(args);

  // URL-encode the Base64 result (handle +, /, = characters)
  const urlSafeBase64 = encodeURIComponent(base64Encoded);

  // Build the final URL, optionally including user email in the path
  if (userEmail) {
    return `${PAYNOW_BUTTON_BASE_URL}/${encodeURIComponent(userEmail)}?q=${urlSafeBase64}`;
  }
  return `${PAYNOW_BUTTON_BASE_URL}/?q=${urlSafeBase64}`;
}

/**
 * Fetch the current payment configuration from the database.
 * Re-exported for convenience from this module.
 */
export { getPaymentConfig, type PaymentConfig } from '@/lib/app-config';

/**
 * Generate a unique payment reference for the Paynow custom field (f1).
 * Format: HERBSCAN-{userId}-{timestamp}
 * This is used to reliably identify the paying user in the webhook notification.
 */
export function generatePaymentReference(userId: string): string {
  const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
  // Use first 12 chars of userId (without dashes) for reasonable length
  const userShort = userId.replace(/-/g, '').substring(0, 12);
  return `HERBSCAN-${userShort}-${timestamp}`;
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
 * Call the Paynow edge function proxy.
 * Used for EcoCash (server-side Paynow call) and for generating card payment hash.
 */
async function callPaynowEdgeFunction(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  return responseData;
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

  const responseData = await callPaynowEdgeFunction({
    type: 'ecocash',
    amount,
    reference,
    phone: normalizedPhone,
    method: 'ecocash',
  });

  const result: PaynowResponse = {
    status: (responseData.status as string) || 'ok',
    browserurl: (responseData.browserurl as string) || undefined,
    pollurl: (responseData.pollurl as string) || undefined,
    hash: (responseData.hash as string) || undefined,
  };

  if (!result.pollurl) {
    throw new Error('No poll URL returned from payment gateway.');
  }

  return result;
}

/**
 * Initiate a Visa/Mastercard payment via Paynow web checkout.
 *
 * Strategy: The Edge Function generates the secure hash (keeping the integration key server-side),
 * then the client makes the POST directly to Paynow's initiatetransaction endpoint.
 * This avoids the "Connection reset by peer" error that occurs when Supabase Edge Functions
 * try to connect to Paynow's servers.
 *
 * Returns a browserurl where the user completes card payment.
 */
export async function initiateCardPayment(
  amount: number,
  reference: string,
  _customerEmail?: string
): Promise<PaynowResponse> {
  // Step 1: Get the hash and payment params from the Edge Function
  const hashData = await callPaynowEdgeFunction({
    type: 'card',
    amount,
    reference,
  });

  const cardData: CardPaymentHashResponse = {
    status: hashData.status as string,
    hash: hashData.hash as string,
    integration_id: hashData.integration_id as string,
    amount: hashData.amount as string,
    additionalinfo: hashData.additionalinfo as string,
    returnurl: hashData.returnurl as string,
    resulturl: hashData.resulturl as string,
    cancelurl: hashData.cancelurl as string,
    authemail: hashData.authemail as string,
  };

  if (!cardData.hash) {
    throw new Error('Failed to generate payment hash. Please try again.');
  }

  // Step 2: Make the direct POST to Paynow from the client
  const formData = new URLSearchParams();
  formData.append('id', cardData.integration_id);
  formData.append('reference', reference);
  formData.append('amount', cardData.amount);
  formData.append('additionalinfo', cardData.additionalinfo);
  formData.append('returnurl', cardData.returnurl);
  formData.append('resulturl', cardData.resulturl);
  if (cardData.cancelurl) {
    formData.append('cancelurl', cardData.cancelurl);
  }
  formData.append('authemail', cardData.authemail);
  formData.append('status', 'Message');
  formData.append('hash', cardData.hash);

  console.log('[paynow] Initiating card payment directly to Paynow...');

  let paynowResponse: Response;
  try {
    paynowResponse = await fetch(PAYNOW_INITIATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : 'Unknown network error';
    console.error('[paynow] Network error connecting to Paynow directly:', msg);
    throw new Error(
      'Unable to connect to Paynow payment gateway. Please check your internet connection and try again.'
    );
  }

  if (!paynowResponse.ok) {
    const errorText = await paynowResponse.text().catch(() => '');
    console.error(`[paynow] Paynow HTTP ${paynowResponse.status}: ${errorText}`);
    throw new Error(`Payment gateway returned an error (HTTP ${paynowResponse.status}). Please try again.`);
  }

  const responseText = await paynowResponse.text();
  console.log('[paynow] Paynow response:', responseText);

  const parsed = parsePaynowResponse(responseText);

  if (parsed.status?.toLowerCase() === 'error') {
    throw new Error(parsed.error || 'Payment initiation failed. Please try again.');
  }

  if (parsed.status?.toLowerCase() !== 'ok') {
    throw new Error(parsed.error || `Unexpected payment status: ${parsed.status}`);
  }

  if (!parsed.browserurl) {
    throw new Error('No checkout URL returned from payment gateway. Please try again.');
  }

  return parsed;
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
 * Check payment status by querying the payments table directly.
 * Used as a fallback when polling Paynow directly doesn't work (e.g., CORS issues).
 * The webhook will have updated the payment status in the database.
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
