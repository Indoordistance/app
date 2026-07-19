// Indoor Distance — Stripe Webhook Edge Function
// Listens for Stripe events and updates the users table accordingly.
//
// SECRETS REQUIRED (set in Supabase → Edge Functions → Manage secrets):
//   STRIPE_SECRET_KEY        - your sk_live_... or sk_test_... (server-only!)
//   STRIPE_WEBHOOK_SECRET    - whsec_... (from Stripe Dashboard → Webhooks → Reveal signing secret)
//   SUPABASE_URL             - your project URL (already set by Supabase automatically)
//   SUPABASE_SERVICE_ROLE_KEY - service role key (already set by Supabase automatically)
//
// STRIPE DASHBOARD SETUP:
//   1. Webhooks → Add endpoint → URL: https://<project>.supabase.co/functions/v1/stripe-webhook
//   2. Events to send: checkout.session.completed, customer.subscription.created/updated/deleted,
//                      invoice.payment_succeeded, invoice.payment_failed
//   3. Reveal signing secret → add as STRIPE_WEBHOOK_SECRET above
//
// MUST RUN THIS SQL FIRST (add columns to users):
//   alter table public.users add column if not exists subscription_status text;
//   alter table public.users add column if not exists subscription_renews_at timestamptz;
//   alter table public.users add column if not exists stripe_customer_id text;

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno&deno-std=0.224.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const cryptoProvider = Stripe.createSubtleCryptoProvider();

async function updateUserByEmail(email: string, patch: Record<string, unknown>) {
  if (!email) return;
  const { error } = await supabase.from("users").update(patch).eq("email", email);
  if (error) console.error("supabase update failed:", error);
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  const whSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  if (!sig || !whSecret) {
    return new Response("Missing signature or secret", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, whSecret, undefined, cryptoProvider);
  } catch (err) {
    console.error("Signature verification failed:", err);
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const email = s.customer_email ?? s.customer_details?.email ?? "";
        if (email && s.subscription) {
          // Fetch subscription details
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await updateUserByEmail(email, {
            subscription_status: sub.status,
            subscription_renews_at: new Date(sub.current_period_end * 1000).toISOString(),
            stripe_customer_id: typeof s.customer === "string" ? s.customer : null,
          });
        } else if (email) {
          // One-time payment
          await updateUserByEmail(email, {
            subscription_status: "paid",
            stripe_customer_id: typeof s.customer === "string" ? s.customer : null,
          });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const cust = await stripe.customers.retrieve(sub.customer as string);
        const email = (cust as Stripe.Customer).email ?? "";
        await updateUserByEmail(email, {
          subscription_status: sub.status,
          subscription_renews_at: new Date(sub.current_period_end * 1000).toISOString(),
          stripe_customer_id: sub.customer as string,
        });
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const cust = await stripe.customers.retrieve(sub.customer as string);
        const email = (cust as Stripe.Customer).email ?? "";
        await updateUserByEmail(email, {
          subscription_status: "canceled",
        });
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const email = inv.customer_email ?? "";
        await updateUserByEmail(email, {
          subscription_status: "past_due",
        });
        break;
      }
    }
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Handler error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
