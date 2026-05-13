import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const DEFAULT_SCANS_PER_TOPUP = 12;
const AMOUNT_USD = 100; // $1.00 in cents

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

    // Fetch scans_per_payment from app_config
    let scansPerTopup = DEFAULT_SCANS_PER_TOPUP;
    try {
      const { data: configData } = await supabaseAdmin
        .from("app_config")
        .select("value")
        .eq("key", "scans_per_payment")
        .single();

      if (configData?.value) {
        const parsed = parseInt(configData.value, 10);
        if (!isNaN(parsed) && parsed > 0) {
          scansPerTopup = parsed;
        }
      }
    } catch (e) {
      console.warn(
        "[create-payment-intent] Could not fetch config, using default",
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
          amount: String(AMOUNT_USD),
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
        amount_usd: AMOUNT_USD / 100,
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
        amount: AMOUNT_USD / 100,
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
