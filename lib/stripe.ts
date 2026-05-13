/**
 * Stripe payment integration utility.
 * Handles creating Payment Intents via the Supabase Edge Function
 * and managing Stripe Payment Sheet presentation.
 */

import { supabase } from '@/lib/supabase';

export interface PaymentIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  paymentId: string;
  scansToAdd: number;
  amount: number;
}

/**
 * Create a Stripe Payment Intent by calling our Edge Function.
 * The edge function creates the intent on Stripe and a pending payment record in DB.
 */
export async function createPaymentIntent(): Promise<PaymentIntentResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error('You must be signed in to make a payment.');
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('Payment service configuration error. Please try again later.');
  }

  let response: Response;
  try {
    response = await fetch(
      `${supabaseUrl}/functions/v1/create-payment-intent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
  } catch (networkError) {
    // Network-level failure (no internet, DNS, CORS, etc.)
    console.error('[stripe] Network error creating payment intent:', networkError);
    throw new Error(
      'Unable to connect to payment service. Please check your internet connection and try again.'
    );
  }

  if (!response.ok) {
    let errorMessage = `Payment setup failed (HTTP ${response.status})`;
    try {
      const errorData = await response.json();
      if (errorData?.error && typeof errorData.error === 'string') {
        errorMessage = errorData.error;
      }
    } catch {
      // If JSON parsing fails, try to get the text response
      try {
        const textBody = await response.text();
        if (textBody) {
          console.error('[stripe] Non-JSON error response:', textBody);
        }
      } catch {
        // Ignore - use default error message
      }
    }
    throw new Error(errorMessage);
  }

  let data: PaymentIntentResponse;
  try {
    data = await response.json();
  } catch {
    throw new Error('Invalid response from payment server. Please try again.');
  }

  if (!data.clientSecret) {
    throw new Error(
      'Payment setup incomplete — no client secret received. Please try again.'
    );
  }

  return data;
}

/**
 * After a successful Stripe payment on the client, confirm it in our DB
 * and credit the user. This is a client-side optimistic update —
 * the webhook will also process it for reliability.
 */
export async function confirmStripePayment(
  paymentId: string,
  userId: string,
  scansToAdd: number
): Promise<{ newCredits: number }> {
  // Update payment status
  const { error: updateError } = await supabase
    .from('payments')
    .update({ status: 'success' })
    .eq('id', paymentId)
    .eq('user_id', userId);

  if (updateError) {
    console.error('[stripe] Failed to update payment status:', updateError);
    // Don't throw — the webhook will handle it
  }

  // Credit the user
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('scan_credits')
    .eq('id', userId)
    .single();

  if (userError || !userData) {
    throw new Error('Failed to update credits. They will be added shortly.');
  }

  const newCredits = (userData.scan_credits || 0) + scansToAdd;

  const { error: creditError } = await supabase
    .from('users')
    .update({ scan_credits: newCredits })
    .eq('id', userId);

  if (creditError) {
    throw new Error('Failed to update credits. They will be added shortly.');
  }

  return { newCredits };
}

/**
 * Mark a payment as failed in our DB.
 */
export async function markPaymentFailed(paymentId: string, userId: string): Promise<void> {
  await supabase
    .from('payments')
    .update({ status: 'failed' })
    .eq('id', paymentId)
    .eq('user_id', userId);
}
