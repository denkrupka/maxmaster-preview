// Supabase Edge Function: Analyze legend region of a construction drawing via Gemini Vision
// Input: cropped legend image (base64) + geometric context (style groups with colors)
// Output: structured legend entries matched to style groups

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { legendImageBase64, mimeType, styleGroupsSummary } = await req.json();

    if (!legendImageBase64) {
      return new Response(
        JSON.stringify({ error: 'legendImageBase64 is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const contextInfo = styleGroupsSummary
      ? `\n\nNa rysunku wykryto nastepujace grupy stylow graficznych (kolor, grubosc linii, typ):\n${styleGroupsSummary}\nUzyj tych informacji do dopasowania wpisow legendy.`
      : '';

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType || 'image/jpeg',
                    data: legendImageBase64,
                  },
                },
                {
                  text: `To jest wycinek legendy z rysunku technicznego instalacji elektrycznej/budowlanej.
Przeanalizuj dokladnie kazdy wpis legendy i zwroc strukturalny JSON.${contextInfo}

Dla kazdego wpisu legendy okresl:
- "label": krotka nazwa/oznaczenie (np. "YDYp 3x2.5", "Oprawa LED 2x36W", "Gniazdo 230V")
- "description": pelny opis z legendy
- "entryType": typ wpisu — "symbol" (element punktowy jak oprawa, gniazdo, wylacznik), "line" (trasa kablowa, przewod, linia), lub "area" (strefa, obszar)
- "color": kolor jakim narysowany jest symbol/linia w legendzie (np. "red", "blue", "#0000ff", "black"). Jesli widoczny kolor — podaj go. Jesli nie ma wyraznego koloru — "black"
- "lineStyle": styl linii jesli to trasa — "solid" (ciagla), "dashed" (przerywana), "dotted" (kropkowana), null jesli to symbol
- "lineWidth": szacunkowa grubosc linii — "thin", "medium", "thick", null jesli to symbol
- "category": kategoria — "Kable i przewody", "Osprzet elektryczny", "Oprawy oswietleniowe", "Tablice rozdzielcze", "Instalacja alarmowa", "Instalacja teletechniczna", "Inne"

WAZNE:
- Czytaj DOKLADNIE tekst z legendy — nie zgaduj, nie wymyslaj
- Jesli wpis ma symbol graficzny (ikone) — opisz go w description
- Jesli wpis to linia (trasa) — zwroc uwage na kolor i styl linii
- Podaj WSZYSTKIE wpisy z legendy, nie pomijaj zadnego`,
                },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                entries: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      label: { type: 'STRING' },
                      description: { type: 'STRING' },
                      entryType: { type: 'STRING' },
                      color: { type: 'STRING' },
                      lineStyle: { type: 'STRING' },
                      lineWidth: { type: 'STRING' },
                      category: { type: 'STRING' },
                    },
                    required: ['label', 'description', 'entryType', 'color', 'category'],
                  },
                },
                drawingType: { type: 'STRING' },
              },
              required: ['entries'],
            },
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to analyze legend with AI', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = await geminiResponse.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsedData = JSON.parse(text);

    return new Response(
      JSON.stringify({ success: true, data: parsedData }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in pdf-analyze-legend function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
