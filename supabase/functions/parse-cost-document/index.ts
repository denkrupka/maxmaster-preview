// Supabase Edge Function for Cost Document Parsing with Google Gemini AI
// Extracts invoice/document data via OCR using Gemini Vision

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
    const { fileBase64, mimeType } = await req.json();

    if (!fileBase64) {
      return new Response(
        JSON.stringify({ error: 'fileBase64 is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const detectedMime = mimeType || 'application/pdf';

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_API_KEY}`,
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
                    data: fileBase64,
                  },
                },
                {
                  text: `Przeanalizuj ten dokument kosztowy (faktura, rachunek, paragon itp.) i wyodrębnij następujące dane. Zwróć JSON z polami:
- document_type: typ dokumentu (np. "Faktura VAT", "Rachunek", "Paragon", "Nota księgowa", "Umowa")
- document_number: numer dokumentu
- issue_date: data wystawienia w formacie YYYY-MM-DD
- payment_due_date: termin płatności w formacie YYYY-MM-DD
- issuer: nazwa wystawcy dokumentu (firma/osoba)
- issuer_nip: NIP wystawcy (sam numer, bez kresek)
- issuer_street: ulica wystawcy (sama nazwa ulicy, np. "Nowy Świat", "Juliusza Słowackiego")
- issuer_building_number: numer budynku wystawcy (TYLKO numer budynku, np. "33", "55"). WAŻNE: jeśli adres zawiera format XX/YY (np. "55/1"), to XX to numer budynku a YY to numer lokalu - rozdziel je!
- issuer_apartment_number: numer lokalu wystawcy (np. "1", "12"). WAŻNE: jeśli adres zawiera format XX/YY (np. "55/1"), to YY to numer lokalu. Pusty string jeśli brak lokalu
- issuer_city: miasto wystawcy (np. "Warszawa")
- issuer_postal_code: kod pocztowy wystawcy (np. "00-029")
- value_netto: wartość netto dokumentu jako liczba (bez waluty, separator dziesiętny to kropka)
- vat_rate: stawka VAT jako liczba procentowa (np. 23 dla 23%)
- value_brutto: wartość brutto dokumentu jako liczba
- category: kategoria kosztów (np. "Materiały", "Usługi", "Transport", "Narzędzia", "Wynajem", "Inne")
- payment_method: metoda płatności na dokumencie. Szukaj słów kluczowych: "przelew"/"przelew bankowy"/"transfer" → "Przelew", "gotówka"/"cash" → "Gotówka", "karta"/"karta płatnicza" → "Karta". Pusty string jeśli nie znaleziono.
- payment_status: czy dokument jest opłacony. Szukaj informacji "opłacone"/"zapłacono"/"paid" → "Opłacone", w przeciwnym razie "Nieopłacone".

Jeśli pole nie jest znalezione, użyj pustego stringa dla tekstu lub 0 dla wartości liczbowych.`,
                },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                document_type: { type: 'STRING' },
                document_number: { type: 'STRING' },
                issue_date: { type: 'STRING' },
                payment_due_date: { type: 'STRING' },
                issuer: { type: 'STRING' },
                issuer_nip: { type: 'STRING' },
                issuer_street: { type: 'STRING' },
                issuer_building_number: { type: 'STRING' },
                issuer_apartment_number: { type: 'STRING' },
                issuer_city: { type: 'STRING' },
                issuer_postal_code: { type: 'STRING' },
                value_netto: { type: 'NUMBER' },
                vat_rate: { type: 'NUMBER' },
                value_brutto: { type: 'NUMBER' },
                category: { type: 'STRING' },
                payment_method: { type: 'STRING' },
                payment_status: { type: 'STRING' },
              },
              required: ['document_type', 'document_number', 'issue_date', 'payment_due_date', 'issuer', 'issuer_nip', 'issuer_street', 'issuer_building_number', 'issuer_apartment_number', 'issuer_city', 'issuer_postal_code', 'value_netto', 'vat_rate', 'value_brutto', 'category', 'payment_method', 'payment_status'],
            },
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to parse document with AI', details: errorText }),
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
    console.error('Error in parse-cost-document function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
