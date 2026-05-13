/**
 * Paynow EcoCash integration (direct remote transaction).
 *
 * This module talks to Paynow's `remotetransaction` endpoint directly from
 * the client to trigger an EcoCash USSD push on the buyer's phone. No local
 * simulation is ever performed — if the network / CORS blocks the request
 * we surface a clear error so the caller does NOT mark the order as paid.
 */

import * as Crypto from "expo-crypto";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Constants (env overridable)
// ---------------------------------------------------------------------------

export const PAYNOW_INTEGRATION_ID =
  process.env.EXPO_PUBLIC_PAYNOW_INTEGRATION_ID ?? "14960";

export const PAYNOW_INTEGRATION_KEY =
  process.env.EXPO_PUBLIC_PAYNOW_INTEGRATION_KEY ??
  "e2cfa088-d2a6-4f73-9c7a-b9f840cd26ce";

export const PAYNOW_MERCHANT_EMAIL = "samkangineer@gmail.com";
export const PAYNOW_REMOTE_URL =
  "https://www.paynow.co.zw/interface/remotetransaction";
export const PAYNOW_RETURN_URL = "https://yourapp.com/payment/return";
export const PAYNOW_RESULT_URL = "https://yourapp.com/payment/result";

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

export async function sha512(text: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA512,
    text,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  return hex.toUpperCase();
}

export async function generateHash(values: string[]): Promise<string> {
  const payload = values.join("") + PAYNOW_INTEGRATION_KEY;
  return sha512(payload);
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

export function parsePaynowResponse(responseText: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!responseText) return out;
  for (const pair of responseText.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, " ")).toLowerCase();
      const value = decodeURIComponent(rawValue.replace(/\+/g, " "));
      out[key] = value;
    } catch {
      out[rawKey.toLowerCase()] = rawValue;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phone helpers
// ---------------------------------------------------------------------------

export interface PhoneValidation {
  valid: boolean;
  error?: string;
}

export function validateZimPhone(phone: string): PhoneValidation {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return { valid: false, error: "Phone number is required." };
  if (digits.startsWith("07")) {
    if (digits.length !== 10)
      return { valid: false, error: "Local numbers must be 10 digits, e.g. 0771234567." };
    return { valid: true };
  }
  if (digits.startsWith("2637")) {
    if (digits.length !== 12)
      return { valid: false, error: "International numbers must be 12 digits, e.g. 263771234567." };
    return { valid: true };
  }
  return { valid: false, error: "Enter a valid Zimbabwe number (07XXXXXXXX or 263XXXXXXXXX)." };
}

export function normalizePhone(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("263") && digits.length === 12) return "0" + digits.slice(3);
  return digits;
}

// ---------------------------------------------------------------------------
// Transaction reference generator
// ---------------------------------------------------------------------------

export function generateTransactionRef(customerName: string): string {
  const name = customerName.replace(/[^a-zA-Z0-9]/g, "").substring(0, 10).toUpperCase();
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").substring(0, 14);
  return `${name}${ts}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaynowPaymentResult {
  success: boolean;
  pollUrl?: string;
  error?: string;
  paynowReference?: string;
  instructions?: string;
}

export interface PaynowPollResult {
  paid: boolean;
  status: string;
  amount?: string;
  reference?: string;
  paynowReference?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Send EcoCash payment
// ---------------------------------------------------------------------------

export async function sendEcoCashPayment(
  amount: number,
  phone: string,
  reference: string
): Promise<PaynowPaymentResult> {
  const normalizedPhone = normalizePhone(phone);
  const amountStr = amount.toFixed(2);
  const additionalInfo = "Plant Scan Credits";
  const status = "Message";
  const method = "ecocash";

  try {
    const hash = await generateHash([
      PAYNOW_INTEGRATION_ID,
      reference,
      amountStr,
      additionalInfo,
      PAYNOW_RETURN_URL,
      PAYNOW_RESULT_URL,
      PAYNOW_MERCHANT_EMAIL,
      normalizedPhone,
      method,
      status,
    ]);

    const formData = new URLSearchParams();
    formData.append("id", PAYNOW_INTEGRATION_ID);
    formData.append("reference", reference);
    formData.append("amount", amountStr);
    formData.append("additionalinfo", additionalInfo);
    formData.append("returnurl", PAYNOW_RETURN_URL);
    formData.append("resulturl", PAYNOW_RESULT_URL);
    formData.append("authemail", PAYNOW_MERCHANT_EMAIL);
    formData.append("phone", normalizedPhone);
    formData.append("method", method);
    formData.append("status", status);
    formData.append("hash", hash);

    const response = await fetch(PAYNOW_REMOTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    const responseText = await response.text();
    if (!responseText?.trim()) {
      return { success: false, error: "No response from payment gateway." };
    }

    const parsed = parsePaynowResponse(responseText);
    const statusLower = (parsed.status || "").toLowerCase();

    if (statusLower === "ok" || statusLower === "sent") {
      return {
        success: true,
        pollUrl: parsed.pollurl || parsed.browserurl,
        paynowReference: parsed.paynowreference,
        instructions: `Payment request sent to ${normalizedPhone}. Enter your EcoCash PIN to complete.`,
      };
    }

    return { success: false, error: parsed.error || `Payment failed: ${parsed.status}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Network error";
    return { success: false, error: `Payment error: ${message}` };
  }
}

/**
 * Check payment status by querying the payments table directly.
 * Requires userId to ensure users can only check their own payments.
 */
export async function checkPaymentStatusFromDB(paymentId: string, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .eq("user_id", userId)
    .single();

  if (error) {
    throw new Error("Failed to check payment status. Please try again.");
  }

  return data?.status || "pending";
}

// ---------------------------------------------------------------------------
// Poll transaction status
// ---------------------------------------------------------------------------

export async function pollTransaction(pollUrl: string): Promise<PaynowPollResult> {
  if (!pollUrl) return { paid: false, status: "Error", error: "No poll URL." };

  try {
    const response = await fetch(pollUrl);
    const responseText = await response.text();
    if (!responseText?.trim()) {
      return { paid: false, status: "No Response", error: "No response from gateway." };
    }

    const parsed = parsePaynowResponse(responseText);
    const statusLower = (parsed.status || "").toLowerCase();
    const isPaid = statusLower === "paid";

    let errorMessage: string | undefined;
    if (!isPaid) {
      switch (statusLower) {
        case "failed": errorMessage = "Payment failed. Try again."; break;
        case "cancelled": errorMessage = "Payment cancelled."; break;
        case "sent":
        case "created": errorMessage = "Payment not yet completed. Check EcoCash."; break;
        default: errorMessage = `Status: ${parsed.status || "Unknown"}.`; break;
      }
    }

    return {
      paid: isPaid,
      status: parsed.status || "Unknown",
      amount: parsed.amount,
      reference: parsed.reference,
      paynowReference: parsed.paynowreference,
      error: errorMessage,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Network error";
    return { paid: false, status: "Error", error: `Verify failed: ${message}` };
  }
}
