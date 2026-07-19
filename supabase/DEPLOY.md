# Deploy AI-coach Edge Function

## Steg 1: Skapa Edge Function

I Supabase Dashboard:
1. Vänster meny → **Edge Functions** → **Deploy a new function**
2. Function name: `ai-coach`
3. Klistra in hela innehållet från `functions/ai-coach/index.ts`
4. Klicka **Deploy function**

## Steg 2: Lägg in din Anthropic-nyckel som secret

1. Edge Functions → **Manage secrets** (knappen uppe till höger)
2. Klicka **Add new secret**
3. Name: `ANTHROPIC_API_KEY`
4. Value: din nyckel från https://console.anthropic.com/settings/keys (börjar med `sk-ant-`)
5. **Save**

## Steg 3: Testa

Öppna appen. AI-chatten ska funka direkt utan att du behöver klistra in någon nyckel via kugghjulet.

Om något inte funkar: F12 → Console. Loggen säger om Edge Function svarar 200 OK eller någon felkod.

## Vanliga fel

- **404 från funktionen** = inte deployad än, eller fel namn (måste vara `ai-coach`)
- **500 ANTHROPIC_API_KEY not set** = secret saknas i steg 2
- **429 rate limit** = nått 30 anrop/minut (per worker), vänta en minut
- **Anthropic-fel** = nyckeln är fel eller har slut på credits

## Kostnad

Claude Sonnet 4.5: ~3 USD per miljon input-tokens, ~15 USD per miljon output-tokens. Ett AI-chatt-svar tar typiskt 2-3000 tokens totalt → ~0,01–0,02 kr per svar. 100 användare som chattar 10 ggr/dag = ~50-100 kr/månad.
