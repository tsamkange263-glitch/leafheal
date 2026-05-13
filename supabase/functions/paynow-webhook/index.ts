import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Default fallback if config fetch fails
const DEFAULT_SCANS_PER_TOPUP = 15;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
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
    // Parse the POST body - Paynow sends URL-encoded form data
    const contentType = req.headers.get("content-type") || "";
    const params: Record<string, string> = {};

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = await req.text();
      const urlParams = new URLSearchParams(body);
      for (const [key, value] of urlParams.entries()) {
        params[key.toLowerCase()] = value;
      }
    } else if (contentType.includes("application/json")) {
      const jsonBody = await req.json();
      for (const [key, value] of Object.entries(jsonBody)) {
        params[key.toLowerCase()] = String(value);
      }
    } else {
      // Try URL-encoded as fallback
      const body = await req.text();
      const urlParams = new URLSearchParams(body);
      for (const [key, value] of urlParams.entries()) {
        params[key.toLowerCase()] = value;
      }
    }

    console.log(
      "[paynow-webhook] Received notification:",
      JSON.stringify(params)
    );

    const status = params.status || "";
    const reference = params.reference || "";
    const amount = params.amount || "";

    // Extract custom field f1 - contains unique user reference
    // Format: HERBSCAN-{userId12chars}-{unixTimestamp}
    // Paynow may return it as f1, field1, or extra1 depending on integration
    const f1 = params.f1 || params.field1 || params.extra1 || "";

    console.log(
      `[paynow-webhook] Status: ${status}, Reference: ${reference}, f1: ${f1}, Amount: ${amount}`
    );

    // Only process successful payments
    const isPaid =
      status.toLowerCase() === "paid" ||
      status.toLowerCase() === "delivered";
    if (!isPaid) {
      console.log(
        `[paynow-webhook] Payment not yet paid (status: ${status}), acknowledging`
      );
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Initialize Supabase admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch scan_quantity from pricing_config table (dynamic configuration)
    let scansPerTopup = DEFAULT_SCANS_PER_TOPUP;
    try {
      const { data: pricingData, error: pricingError } = await supabase
        .from("pricing_config")
        .select("scan_quantity")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (!pricingError && pricingData?.scan_quantity) {
        const parsed = pricingData.scan_quantity;
        if (parsed > 0) {
          scansPerTopup = parsed;
          console.log(
            `[paynow-webhook] Using configured scan_quantity: ${scansPerTopup}`
          );
        }
      } else {
        console.warn(
          `[paynow-webhook] Could not fetch pricing config, using default: ${DEFAULT_SCANS_PER_TOPUP}`
        );
      }
    } catch (configErr) {
      console.warn(
        `[paynow-webhook] Error fetching pricing config, using default: ${DEFAULT_SCANS_PER_TOPUP}`,
        configErr
      );
    }

    let paymentRecord: Record<string, unknown> | null = null;
    let userId: string | null = null;

    // PRIMARY: Look up payment by f1 custom field reference (most reliable)
    // The f1 field contains the unique reference we passed in the Paynow URL
    if (f1 && f1.startsWith("HERBSCAN-")) {
      console.log(
        `[paynow-webhook] Looking up payment by f1 reference: ${f1}`
      );
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("paynow_reference", f1)
        .in("status", ["pending", "sent"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        paymentRecord = data;
        userId = data.user_id;
        console.log(
          `[paynow-webhook] Found payment by f1 reference. User: ${userId}, Payment ID: ${data.id}`
        );
      }
    }

    // FALLBACK: Look up by transaction reference if f1 lookup failed
    if (!paymentRecord && reference) {
      console.log(
        `[paynow-webhook] Falling back to reference lookup: ${reference}`
      );
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("paynow_reference", reference)
        .in("status", ["pending", "sent"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        paymentRecord = data;
        userId = data.user_id;
        console.log(
          `[paynow-webhook] Found payment by reference. User: ${userId}`
        );
      }
    }

    // LAST RESORT: Look up by HERBSCAN pattern in reference field
    if (!paymentRecord && reference && reference.startsWith("HERBSCAN-")) {
      console.log(
        `[paynow-webhook] Trying HERBSCAN reference pattern lookup`
      );
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .like("paynow_reference", `${reference}%`)
        .in("status", ["pending", "sent"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        paymentRecord = data;
        userId = data.user_id;
        console.log(
          `[paynow-webhook] Found payment by HERBSCAN pattern. User: ${userId}`
        );
      }
    }

    if (!paymentRecord || !userId) {
      console.error(
        `[paynow-webhook] Could not find matching payment record. f1: ${f1}, reference: ${reference}`
      );
      // Return 200 to acknowledge receipt even if we can't process it
      return new Response("OK - no matching payment found", {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Update payment status to success
    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: "success" })
      .eq("id", (paymentRecord as { id: string }).id);

    if (updateError) {
      console.error(
        `[paynow-webhook] Failed to update payment status:`,
        updateError
      );
    } else {
      console.log(
        `[paynow-webhook] Payment ${(paymentRecord as { id: string }).id} marked as success`
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
        `[paynow-webhook] Failed to fetch user ${userId}:`,
        userError
      );
      return new Response("OK - payment updated but user credit failed", {
        status: 200,
        headers: corsHeaders,
      });
    }

    const newCredits = (userData.scan_credits || 0) + scansPerTopup;
    const { error: creditError } = await supabase
      .from("users")
      .update({ scan_credits: newCredits })
      .eq("id", userId);

    if (creditError) {
      console.error(
        `[paynow-webhook] Failed to credit user ${userId}:`,
        creditError
      );
    } else {
      console.log(
        `[paynow-webhook] User ${userId} credited with ${scansPerTopup} scans. New balance: ${newCredits}`
      );
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error("[paynow-webhook] Unhandled error:", error);
    // Always return 200 to Paynow to prevent retries that could cause duplicate credits
    return new Response("OK - error processed", {
      status: 200,
      headers: corsHeaders,
    });
  }
});
