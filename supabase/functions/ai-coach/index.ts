// Indoor Distance — AI Coach Edge Function
// Deploy: in Supabase Dashboard → Edge Functions → "New Function" → name: ai-coach
// Then add ANTHROPIC_API_KEY as a secret (Edge Functions → Manage Secrets).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Simple in-memory rate limit (per Edge worker instance — restarts wipe it)
const RL = new Map<string, { count: number; reset: number }>();
const RL_MAX = 30;          // requests per window
const RL_WINDOW = 60_000;   // 1 minute

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const entry = RL.get(ip);
  if (!entry || now > entry.reset) {
    RL.set(ip, { count: 1, reset: now + RL_WINDOW });
    return true;
  }
  if (entry.count >= RL_MAX) return false;
  entry.count++;
  return true;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Rate-limit by IP
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  if (!rateLimitOk(ip)) {
    return new Response(JSON.stringify({ error: "Rate limit (30/min). Try again shortly." }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY secret is not set in Supabase" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, system } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Missing messages array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Truncate history to last 20 messages to keep tokens reasonable
    const trimmed = messages.slice(-20);

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: system ?? "You are an elite throws coach.",
        messages: trimmed,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return new Response(JSON.stringify({ error: `Anthropic ${upstream.status}`, detail: detail.slice(0, 400) }), {
        status: upstream.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await upstream.json();
    const reply = data?.content?.[0]?.text ?? "";
    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
