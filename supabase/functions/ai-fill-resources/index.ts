// Supabase Edge Function: AI-powered resource/price fill for kosztorys positions
// Fills nakłady (labor/material/equipment norms) or prices based on KNR codes

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
    const { positions, mode, resourceTypes, quarter } = await req.json();
    // positions: [{id, name, base, unit, resources?: [{type, name, unit, norm}]}]
    // mode: 'resources' | 'prices'
    // resourceTypes: ['labor', 'material', 'equipment']
    // quarter: 'Q1 2026' (dynamic)

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

    const count = positions.length;
    const typesStr = (resourceTypes || ['labor', 'material', 'equipment']).join(', ');

    let prompt = '';

    if (mode === 'resources') {
      // Fill nakłady (norms)
      const posList = positions.map((p: any, i: number) => {
        return `${i}. KNR: "${p.base || 'brak'}" | Nazwa: "${p.name}" | J.m.: ${p.unit || 'szt.'}`;
      }).join('\n');

      prompt = `Jesteś ekspertem od polskich kosztorysów budowlanych i katalogów KNR/KNNR.

Dla ${count} pozycji kosztorysowych uzupełnij nakłady rzeczowe (normy zużycia).

Typy nakładów do uzupełnienia: ${typesStr}

Pozycje:
${posList}

Zwróć TYLKO JSON: {"r":[...]}
Każdy element tablicy "r":
[index, [nakłady...]]

Każdy nakład to tablica:
["typ", "nazwa", "j.m.", norma, "indeks"]

typ: "labor" (robocizna), "material" (materiał), "equipment" (sprzęt)
j.m.: "r-g" (robocizna), "szt."/"m"/"m2"/"m3"/"kg"/"t" (materiał), "m-g" (sprzęt)
norma: wartość normy zużycia na jednostkę pozycji (liczba)
indeks: opcjonalny indeks katalogowy

Przykład:
{"r":[[0,[["labor","Robotnicy budowlani","r-g",1.35,""],["material","Kabel YKY 3x2.5mm2","m",1.05,""],["equipment","Koparka 0.15m3","m-g",0.08,""]]]]}

ZASADY:
- Podaj REALNE normy z katalogów KNR/KNNR (nie wymyślaj)
- Normy podaj na 1 jednostkę pozycji
- Robocizna w r-g (roboczogodzinach)
- Sprzęt w m-g (maszynogodzinach)
- Materiały w odpowiednich jednostkach (m, m2, m3, kg, szt., kpl.)
- Dla każdej pozycji podaj 2-5 nakładów (typowe dla danej pozycji KNR)
- MUSISZ zwrócić wynik dla WSZYSTKICH ${count} pozycji`;

    } else {
      // Fill prices
      const posList = positions.map((p: any, i: number) => {
        const resources = (p.resources || []).map((r: any) =>
          `  - ${r.type}: "${r.name}" [${r.unit}]`
        ).join('\n');
        return `${i}. "${p.name}" (KNR: ${p.base || 'brak'})\n${resources}`;
      }).join('\n');

      prompt = `Jesteś ekspertem od cen materiałów i robót budowlanych w Polsce.

Podaj aktualne ceny jednostkowe dla nakładów w ${count} pozycjach kosztorysowych.
Ceny powinny być z ${quarter || 'najnowszego dostępnego kwartału'} lub najnowsze dostępne.

Typy do wyceny: ${typesStr}

Pozycje z nakładami:
${posList}

Zwróć TYLKO JSON: {"r":[...]}
Każdy element: [index, [[resource_index, cena_PLN], ...]]

Przykład (pozycja 0 ma 3 nakłady, wyceniamy nakład 0 na 52.50 PLN i nakład 1 na 8.30 PLN):
{"r":[[0,[[0,52.50],[1,8.30],[2,120.00]]]]}

ZASADY:
- Ceny w PLN netto (bez VAT)
- Robocizna: stawka za r-g (typowo 45-65 PLN/r-g w ${quarter || '2026'})
- Materiały: cena jednostkowa (realna cena rynkowa)
- Sprzęt: stawka za m-g (typowo 80-200 PLN/m-g)
- Podaj ceny dla WSZYSTKICH nakładów we WSZYSTKICH ${count} pozycjach
- Ceny muszą być realistyczne i aktualne`;
    }

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
          messages: [{ role: 'user', content: prompt }],
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
          JSON.stringify({ error: 'AI fill failed', details: errorText }),
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

      return new Response(
        JSON.stringify({ success: true, data: parsed, mode }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'All API keys rate limited', details: lastError }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ai-fill-resources:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
