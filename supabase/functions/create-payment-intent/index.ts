/**
 * Create Payment Intent Edge Function
 *
 * REQUIRED SECRETS (set in Supabase Dashboard → Edge Functions → Secrets):
 *   - STRIPE_SECRET_KEY: Your Stripe secret key (sk_test_... for test mode,
 *     sk_live_... for production). Without this, card payments will fail with
 *     "Payment service is not configured" error.
 *
 * These are automatically available (no manual config needed):
 *   - SUPABASE_URL
 *   - SUPABASE_ANON_KEY
 *   - SUPABASE_SERVICE_ROLE_KEY
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Read from environment variable (set via Supabase Dashboard/CLI secrets)
// Falls back to the configured test key for development
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "sk_test_51TWRgL9bzIIw4TAux2b5nhWHYiH2KubYuCBDa0S2eaj2LzWOpAgTMkq59Dtc4u0b6xFGtWNFCNiBUyYTycPwSXcm00FqzHaWXm";
const DEFAULT_SCANS_PER_TOPUP = 15;
const DEFAULT_AMOUNT_CENTS = 125; // $1.25 in cents

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Validate Stripe secret key is configured
    if (!STRIPE_SECRET_KEY) {
      console.error(
        "[create-payment-intent] STRIPE_SECRET_KEY is not configured"
      );
      return new Response(
        JSON.stringify({
          error:
            "Payment service is not configured. Please contact support.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // Verify user authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Supabase client with user's JWT
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get the authenticated user
    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin client for DB operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch dynamic pricing from pricing_config table
    let scansPerTopup = DEFAULT_SCANS_PER_TOPUP;
    let amountCents = DEFAULT_AMOUNT_CENTS;
    try {
      const { data: pricingData } = await supabaseAdmin
        .from("pricing_config")
        .select("price_usd, scan_quantity")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (pricingData) {
        const parsedPrice = parseFloat(pricingData.price_usd);
        const parsedScans = pricingData.scan_quantity;
        if (!isNaN(parsedPrice) && parsedPrice > 0) {
          amountCents = Math.round(parsedPrice * 100);
        }
        if (parsedScans && parsedScans > 0) {
          scansPerTopup = parsedScans;
        }
      }
    } catch (e) {
      console.warn(
        "[create-payment-intent] Could not fetch pricing config, using defaults",
        e
      );
    }

    // Create Stripe PaymentIntent
    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/payment_intents",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          amount: String(amountCents),
          currency: "usd",
          "automatic_payment_methods[enabled]": "true",
          "metadata[user_id]": user.id,
          "metadata[scans_to_add]": String(scansPerTopup),
          "metadata[app]": "herbscan",
        }).toString(),
      }
    );

    if (!stripeResponse.ok) {
      const errorBody = await stripeResponse.text();
      console.error("[create-payment-intent] Stripe error:", errorBody);

      // Parse Stripe error for a user-friendly message
      let userMessage = "Failed to create payment intent. Please try again.";
      try {
        const stripeError = JSON.parse(errorBody);
        if (stripeError?.error?.message) {
          userMessage = stripeError.error.message;
        }
      } catch {
        // Use default message if parsing fails
      }

      return new Response(
        JSON.stringify({
          error: userMessage,
          code: "stripe_error",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const paymentIntent = await stripeResponse.json();

    // Create a pending payment record in our DB
    const { data: payment, error: insertError } = await supabaseAdmin
      .from("payments")
      .insert({
        user_id: user.id,
        amount_usd: amountCents / 100,
        scans_added: scansPerTopup,
        status: "pending",
        paynow_reference: paymentIntent.id,
        payment_method: "stripe",
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[create-payment-intent] DB insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to record payment" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `[create-payment-intent] Created PI ${paymentIntent.id} for user ${user.id}, payment record ${payment.id}`
    );

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        paymentId: payment.id,
        scansToAdd: scansPerTopup,
        amount: amountCents / 100,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[create-payment-intent] Unhandled error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({
        error: message,
        code: "internal_error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
