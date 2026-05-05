import * as Crypto from 'expo-crypto';

// Paynow configuration constants
const PAYNOW_INTEGRATION_ID = process.env.EXPO_PUBLIC_PAYNOW_INTEGRATION_ID ?? '14960';
const PAYNOW_INTEGRATION_KEY =
  process.env.EXPO_PUBLIC_PAYNOW_INTEGRATION_KEY ?? 'e2cfa088-d2a6-4f73-9c7a-b9f840cd26ce';
const PAYNOW_MERCHANT_EMAIL = 'samkangineer@gmail.com';
const PAYNOW_REMOTE_URL = 'https://www.paynow.co.zw/interface/remotetransaction';
const PAYNOW_INITIATE_URL = 'https://www.paynow.co.zw/interface/initiatetransaction';
const PAYNOW_RETURN_URL = 'https://yourapp.com/payment/return';
const PAYNOW_RESULT_URL = 'https://yourapp.com/payment/result';

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
 * Generate SHA512 hash of a string using expo-crypto
 */
async function sha512(input: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA512,
    input
  );
  return hash.toUpperCase();
}

/**
 * Generate a Paynow hash by joining field values and the integration key, then hashing
 */
async function generateHash(values: string[]): Promise<string> {
  const joinedString = values.join('') + PAYNOW_INTEGRATION_KEY;
  return sha512(joinedString);
}

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
 * Send an EcoCash payment request via Paynow remote transaction API.
 * Returns the parsed response containing pollurl on success.
 */
export async function sendEcoCashPayment(
  amount: number,
  phone: string,
  reference: string
): Promise<PaynowResponse> {
  const normalizedPhone = normalizePhone(phone);
  const amountStr = amount.toFixed(2);

  // Build the values array for hash generation (order matters: must match form fields order)
  const hashValues = [
    PAYNOW_INTEGRATION_ID,
    reference,
    amountStr,
    `HerbScan Top Up - ${reference}`,
    PAYNOW_RETURN_URL,
    PAYNOW_RESULT_URL,
    PAYNOW_MERCHANT_EMAIL,
    normalizedPhone,
    'ecocash',
    'Message',
  ];

  const hash = await generateHash(hashValues);

  // Build form data
  const formData = new URLSearchParams();
  formData.append('id', PAYNOW_INTEGRATION_ID);
  formData.append('reference', reference);
  formData.append('amount', amountStr);
  formData.append('additionalinfo', `HerbScan Top Up - ${reference}`);
  formData.append('returnurl', PAYNOW_RETURN_URL);
  formData.append('resulturl', PAYNOW_RESULT_URL);
  formData.append('authemail', PAYNOW_MERCHANT_EMAIL);
  formData.append('phone', normalizedPhone);
  formData.append('method', 'ecocash');
  formData.append('status', 'Message');
  formData.append('hash', hash);

  const response = await fetch(PAYNOW_REMOTE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(`Paynow request failed with status ${response.status}`);
  }

  const responseText = await response.text();
  const parsed = parsePaynowResponse(responseText);

  if (parsed.status?.toLowerCase() === 'error') {
    throw new Error(parsed.error || 'Payment initiation failed. Please try again.');
  }

  if (parsed.status?.toLowerCase() !== 'ok') {
    throw new Error(parsed.error || `Unexpected response: ${parsed.status}`);
  }

  if (!parsed.pollurl) {
    throw new Error('No poll URL returned from payment gateway.');
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
 * Initiate a standard Paynow web checkout for Visa/Mastercard payments.
 * Returns a browserurl where the user completes card payment, and a pollurl for status checks.
 */
export async function initiateCardPayment(
  amount: number,
  reference: string,
  email: string
): Promise<PaynowResponse> {
  const amountStr = amount.toFixed(2);

  // Build the values array for hash generation
  // Order: id, reference, amount, additionalinfo, returnurl, resulturl, authemail, status
  const hashValues = [
    PAYNOW_INTEGRATION_ID,
    reference,
    amountStr,
    `HerbScan Top Up - ${reference}`,
    PAYNOW_RETURN_URL,
    PAYNOW_RESULT_URL,
    email || PAYNOW_MERCHANT_EMAIL,
    'Message',
  ];

  const hash = await generateHash(hashValues);

  // Build form data for standard initiate transaction
  const formData = new URLSearchParams();
  formData.append('id', PAYNOW_INTEGRATION_ID);
  formData.append('reference', reference);
  formData.append('amount', amountStr);
  formData.append('additionalinfo', `HerbScan Top Up - ${reference}`);
  formData.append('returnurl', PAYNOW_RETURN_URL);
  formData.append('resulturl', PAYNOW_RESULT_URL);
  formData.append('authemail', email || PAYNOW_MERCHANT_EMAIL);
  formData.append('status', 'Message');
  formData.append('hash', hash);

  const response = await fetch(PAYNOW_INITIATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(`Paynow request failed with status ${response.status}`);
  }

  const responseText = await response.text();
  const parsed = parsePaynowResponse(responseText);

  if (parsed.status?.toLowerCase() === 'error') {
    throw new Error(parsed.error || 'Payment initiation failed. Please try again.');
  }

  if (parsed.status?.toLowerCase() !== 'ok') {
    throw new Error(parsed.error || `Unexpected response: ${parsed.status}`);
  }

  if (!parsed.browserurl) {
    throw new Error('No browser URL returned from payment gateway.');
  }

  if (!parsed.pollurl) {
    throw new Error('No poll URL returned from payment gateway.');
  }

  return parsed;
}
