import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const DEFAULT_SCANS_PER_TOPUP = 12;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  // Parse the signature header
  const elements = signature.split(",");
  let timestamp = "";
  const signatures: string[] = [];

  for (const element of elements) {
    const [key, value] = element.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return false;

  // Check timestamp tolerance (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedPayload)
  );
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return signatures.includes(expectedSignature);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature") || "";

    // Verify webhook signature if secret is configured
    if (STRIPE_WEBHOOK_SECRET && signature) {
      const isValid = await verifyStripeSignature(
        body,
        signature,
        STRIPE_WEBHOOK_SECRET
      );
      if (!isValid) {
        console.error("[stripe-webhook] Invalid signature");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const event = JSON.parse(body);
    console.log(`[stripe-webhook] Received event: ${event.type}`);

    // Only process successful payment intents
    if (event.type !== "payment_intent.succeeded") {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentIntent = event.data.object;
    const userId = paymentIntent.metadata?.user_id;
    const scansToAdd = parseInt(
      paymentIntent.metadata?.scans_to_add || String(DEFAULT_SCANS_PER_TOPUP),
      10
    );
    const paymentIntentId = paymentIntent.id;

    console.log(
      `[stripe-webhook] Payment succeeded: ${paymentIntentId}, user: ${userId}, scans: ${scansToAdd}`
    );

    if (!userId) {
      console.error("[stripe-webhook] No user_id in metadata");
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialize admin Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find and update the payment record
    const { data: paymentRecord, error: findError } = await supabase
      .from("payments")
      .select("id, status")
      .eq("paynow_reference", paymentIntentId)
      .single();

    if (findError || !paymentRecord) {
      console.error(
        `[stripe-webhook] Payment record not found for PI: ${paymentIntentId}`,
        findError
      );
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if already processed (idempotency)
    if (paymentRecord.status === "success") {
      console.log(
        `[stripe-webhook] Payment ${paymentRecord.id} already processed, skipping`
      );
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update payment status to success
    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: "success" })
      .eq("id", paymentRecord.id);

    if (updateError) {
      console.error(
        `[stripe-webhook] Failed to update payment:`,
        updateError
      );
    }

    // Credit user with scans
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("scan_credits")
      .eq("id", userId)
      .single();

    if (userError || !userData) {
      console.error(
        `[stripe-webhook] Failed to fetch user ${userId}:`,
        userError
      );
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newCredits = (userData.scan_credits || 0) + scansToAdd;
    const { error: creditError } = await supabase
      .from("users")
      .update({ scan_credits: newCredits })
      .eq("id", userId);

    if (creditError) {
      console.error(
        `[stripe-webhook] Failed to credit user ${userId}:`,
        creditError
      );
    } else {
      console.log(
        `[stripe-webhook] User ${userId} credited with ${scansToAdd} scans. New balance: ${newCredits}`
      );
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[stripe-webhook] Unhandled error:", error);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
