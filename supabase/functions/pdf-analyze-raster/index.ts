// Supabase Edge Function for Raster PDF Drawing Analysis with Gemini Vision
// Analyzes scanned/raster electrical drawings using AI

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
    const { imageBase64, mimeType, pageNumber, ocrContext } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'imageBase64 is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const detectedMime = mimeType || 'image/jpeg';

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
                    mime_type: detectedMime,
                    data: imageBase64,
                  },
                },
                {
                  text: `Analizujesz rysunek techniczny instalacji elektrycznej (strona ${pageNumber || 1}).${ocrContext ? `\n\nDodatkowy kontekst z OCR: ${ocrContext}` : ''}
Zidentyfikuj wszystkie elementy na rysunku i zwróć JSON z następującą strukturą:

1. "symbols" — tablica wykrytych symboli/elementów, każdy z polami:
   - "type": nazwa elementu (np. "Oprawa oświetleniowa LED", "Gniazdo wtykowe 230V", "Wyłącznik świecznikowy")
   - "category": jedna z kategorii: "Kable", "Oprawy", "Osprzęt", "Trasy", "Tablice", "Alarmy", "Inne"
   - "count": ilość wykrytych wystąpień na rysunku
   - "description": krótki opis (opcjonalny)

2. "routes" — tablica tras kablowych/przewodów, każda z polami:
   - "type": typ kabla/przewodu (np. "YDYp 3x2.5", "YKY 5x10")
   - "category": "Kable"
   - "estimatedLengthM": szacunkowa długość w metrach
   - "description": opis trasy (opcjonalny)

3. "scaleText" — tekst skali znaleziony na rysunku (np. "1:100") lub null
4. "legendEntries" — tablica wpisów z legendy rysunku, każdy z polami:
   - "symbol": opis symbolu z legendy
   - "description": opis znaczenia
   - "category": kategoria
5. "drawingType" — typ rysunku (np. "Instalacja oświetleniowa", "Instalacja gniazd", "Schemat rozdzielnicy")

WAŻNE:
- Policz dokładnie każdy symbol na rysunku
- Rozróżniaj typy opraw oświetleniowych (LED, fluorescencyjne, awaryjne)
- Rozróżniaj typy gniazd (230V, DATA, TV)
- Jeśli widzisz legendę — użyj jej do identyfikacji symboli
- Szacuj długości tras w oparciu o skalę rysunku`,
                },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                symbols: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      type: { type: 'STRING' },
                      category: { type: 'STRING' },
                      count: { type: 'NUMBER' },
                      description: { type: 'STRING' },
                    },
                    required: ['type', 'category', 'count'],
                  },
                },
                routes: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      type: { type: 'STRING' },
                      category: { type: 'STRING' },
                      estimatedLengthM: { type: 'NUMBER' },
                      description: { type: 'STRING' },
                    },
                    required: ['type', 'category', 'estimatedLengthM'],
                  },
                },
                scaleText: { type: 'STRING' },
                legendEntries: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      symbol: { type: 'STRING' },
                      description: { type: 'STRING' },
                      category: { type: 'STRING' },
                    },
                    required: ['symbol', 'description', 'category'],
                  },
                },
                drawingType: { type: 'STRING' },
              },
              required: ['symbols', 'routes', 'scaleText', 'legendEntries', 'drawingType'],
            },
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to analyze drawing with AI', details: errorText }),
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
    console.error('Error in pdf-analyze-raster function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
