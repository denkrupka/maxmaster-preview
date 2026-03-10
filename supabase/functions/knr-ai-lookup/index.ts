// Supabase Edge Function: AI-based KNR code lookup
// Compact output format for speed — max positions per request

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

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

    // Build compact position list
    const positionsList = positions.map((p: { id: string; name: string; unit?: string }, i: number) =>
      `${i}. ${p.name}${p.unit ? ` [${p.unit}]` : ''}`
    ).join('\n');

    // Compact prompt — minimal output format to save tokens
    const prompt = `Ekspert KNR/KNNR. Dla każdej pozycji podaj numer KNR.

Pozycje:
${positionsList}

Zwróć TYLKO JSON (bez markdown):
{"r":[[index,"KNR kod","opis z katalogu",confidence],...]}

Przykład: {"r":[[0,"KNR 4-03 0313-10","Montaż rur PE",0.8],[1,"KNNR 5 0407-01","Układanie kabli",0.7]]}

Zasady:
- "KNR kod" w formacie "TYP KATALOG TABELA-WARIANT" (np. "KNR 2-02 0803-02")
- "opis" — krótki oficjalny opis z katalogu (max 60 znaków)
- confidence 0.0-1.0
- Jeśli nie pewny (confidence<0.3) — pomiń tę pozycję
- Katalogi: KNR, KNNR, KNR-W, KNNR-W, KSNR, KNP, NNRNKB`;

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
          max_tokens: 4096,
          messages: [
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (claudeResponse.status === 429) {
        lastError = await claudeResponse.text();
        console.warn(`Key ${attempt + 1}/${API_KEYS.length} rate limited, trying next...`);
        continue;
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
      if (jsonMatch) jsonText = jsonMatch[1].trim();

      const parsed = JSON.parse(jsonText);

      // Convert compact format to standard format
      const results = (parsed.r || []).map((item: any[]) => ({
        index: item[0],
        knr_code: item[1] || '',
        knr_description: item[2] || '',
        confidence: item[3] || 0,
      }));

      return new Response(
        JSON.stringify({ success: true, data: { results } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'All API keys rate limited', details: lastError }),
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
