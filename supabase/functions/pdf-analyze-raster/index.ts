// Supabase Edge Function: Analyze PDF drawing with Claude Vision (Anthropic)
// Unified for both vector and raster PDFs

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
    const { imageBase64, mimeType, pageNumber, ocrContext } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'imageBase64 is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!CLAUDE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'CLAUDE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const detectedMime = mimeType || 'image/jpeg';

    const systemPrompt = `Jesteś ekspertem od analizy rysunków technicznych instalacji elektrycznych i budowlanych.
Analizujesz rysunek i zwracasz WYŁĄCZNIE poprawny JSON — bez komentarzy, bez markdown.

Zasady:
- Czytaj legendę DOKŁADNIE — przepisuj nazwy symboli i opisy dosłownie z rysunku
- Licz symbole precyzyjnie — każdy symbol na rysunku osobno
- Rozróżniaj typy: oprawy LED vs fluorescencyjne vs awaryjne, gniazda 230V vs DATA vs TV
- Trasy kablowe: podaj typ kabla jeśli widoczny (np. YDYp 3x2.5) i szacunkową długość
- Jeśli nie widzisz skali — napisz null
- Nie wymyślaj elementów których nie ma na rysunku`;

    const userPrompt = `Przeanalizuj ten rysunek techniczny (strona ${pageNumber || 1}).${ocrContext ? `\n\nDodatkowy kontekst: ${ocrContext}` : ''}

Zwróć JSON z dokładnie taką strukturą:
{
  "symbols": [
    {"type": "nazwa elementu", "category": "kategoria", "count": liczba, "description": "opis"}
  ],
  "routes": [
    {"type": "typ kabla", "category": "Kable", "estimatedLengthM": długość_w_metrach, "description": "opis"}
  ],
  "scaleText": "1:100" lub null,
  "legendEntries": [
    {"symbol": "oznaczenie z legendy", "description": "opis z legendy", "category": "kategoria"}
  ],
  "drawingType": "typ rysunku"
}

Kategorie: "Kable i przewody", "Osprzęt elektryczny", "Oprawy oświetleniowe", "Tablice rozdzielcze", "Instalacja alarmowa", "Instalacja teletechniczna", "Inne"

WAŻNE:
- Przepisz WSZYSTKIE wpisy z legendy dosłownie
- Policz KAŻDY symbol na rysunku osobno
- Dla tras podaj szacunkową długość w metrach (na podstawie skali)
- Jeśli element powtarza się — podaj łączną liczbę wystąpień`;

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
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: detectedMime,
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: userPrompt,
              },
            ],
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('Claude API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to analyze drawing with AI', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const claudeData = await claudeResponse.json();

    // Extract text content from Claude response
    const textContent = claudeData.content?.find((c: any) => c.type === 'text')?.text || '{}';

    // Parse JSON — Claude may wrap it in ```json blocks
    let jsonStr = textContent.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsedData = JSON.parse(jsonStr);

    return new Response(
      JSON.stringify({ success: true, data: parsedData }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in pdf-analyze-raster function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
