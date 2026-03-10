// Supabase Edge Function: AI-based KNR code lookup
// Takes position names and returns suggested KNR codes via Claude AI
// Supports multiple API keys for round-robin rate limit distribution

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Load all available API keys (CLAUDE_API_KEY, CLAUDE_API_KEY_2, CLAUDE_API_KEY_3, ...)
const API_KEYS: string[] = [];
const primary = Deno.env.get('CLAUDE_API_KEY');
if (primary) API_KEYS.push(primary);
for (let i = 2; i <= 10; i++) {
  const key = Deno.env.get(`CLAUDE_API_KEY_${i}`);
  if (key) API_KEYS.push(key);
}

let keyIndex = 0;
const getNextKey = (): string => {
  const key = API_KEYS[keyIndex % API_KEYS.length];
  keyIndex++;
  return key;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { positions } = await req.json();

    if (!positions || !Array.isArray(positions) || positions.length === 0) {
      return new Response(
        JSON.stringify({ error: 'positions array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (API_KEYS.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No CLAUDE_API_KEY configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build prompt with positions list
    const positionsList = positions.map((p: { id: string; name: string; unit?: string }, i: number) =>
      `${i + 1}. Nazwa: "${p.name}"${p.unit ? `, j.m.: ${p.unit}` : ''}`
    ).join('\n');

    const prompt = `Jesteś ekspertem od polskich katalogów nakładów rzeczowych (KNR, KNNR, KSNR, KNR-W, KNNR-W).

Dla każdej pozycji kosztorysowej poniżej, zaproponuj najbardziej odpowiedni numer KNR/KNNR.

Format numeru: "TYP KATALOG TABELA-WARIANT", np.:
- "KNR 4-03 0313-10"
- "KNNR 5 0407-01"
- "KNR 2-02 0803-02"
- "KNR-W 2-18 0704-01"

Dostępne typy katalogów: KNR, KNNR, KNR-W, KNNR-W, KSNR, KNP, NNRNKB.

Pozycje do analizy:
${positionsList}

Zwróć TYLKO czysty JSON (bez markdown, bez komentarzy) w formacie:
{
  "results": [
    {
      "index": 0,
      "knr_code": "KNR X-XX XXXX-XX",
      "knr_description": "oficjalna nazwa pozycji z katalogu KNR",
      "confidence": 0.85,
      "reasoning": "krótkie uzasadnienie"
    }
  ]
}

Pole "index" odpowiada numerowi pozycji (0-based).
Pole "knr_description" to oficjalny opis pozycji z katalogu KNR (jak ta pozycja nazywa się w katalogu).
Pole "confidence" to pewność dopasowania od 0.0 do 1.0.
Jeśli nie jesteś pewny danej pozycji (confidence < 0.3), ustaw knr_code na pusty string "".`;

    // Try with round-robin key, fallback to next key on rate limit
    let lastError = '';
    for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
      const apiKey = getNextKey();

      const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          messages: [
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (claudeResponse.status === 429) {
        lastError = await claudeResponse.text();
        console.warn(`Key ${attempt + 1}/${API_KEYS.length} rate limited, trying next...`);
        continue; // try next key
      }

      if (!claudeResponse.ok) {
        const errorText = await claudeResponse.text();
        console.error('Claude API error:', claudeResponse.status, errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to lookup KNR with AI', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const claudeData = await claudeResponse.json();
      const textBlock = claudeData.content?.find((b: { type: string }) => b.type === 'text');
      const rawText = textBlock?.text || '{}';

      let jsonText = rawText.trim();
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }

      const parsedData = JSON.parse(jsonText);

      return new Response(
        JSON.stringify({ success: true, data: parsedData, keysAvailable: API_KEYS.length }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // All keys exhausted
    return new Response(
      JSON.stringify({ error: 'All API keys rate limited', details: lastError, keysAvailable: API_KEYS.length }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in knr-ai-lookup function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
