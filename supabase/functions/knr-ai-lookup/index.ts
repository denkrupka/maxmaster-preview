// Supabase Edge Function: AI-based KNR code lookup
// Takes position names and returns suggested KNR codes via Claude AI

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CLAUDE_API_KEY = Deno.env.get('CLAUDE_API_KEY');

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

    if (!CLAUDE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'CLAUDE_API_KEY not configured' }),
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
      "confidence": 0.85,
      "reasoning": "krótkie uzasadnienie"
    }
  ]
}

Pole "index" odpowiada numerowi pozycji (0-based).
Pole "confidence" to pewność dopasowania od 0.0 do 1.0.
Jeśli nie jesteś pewny danej pozycji (confidence < 0.3), ustaw knr_code na pusty string "".`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

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
      JSON.stringify({ success: true, data: parsedData }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in knr-ai-lookup function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
