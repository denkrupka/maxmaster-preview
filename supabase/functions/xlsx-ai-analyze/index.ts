// Supabase Edge Function: AI-powered XLSX structure analysis
// Analyzes spreadsheet rows to detect columns, sections, subsections, and rows to ignore
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
    const { rows, sheetName } = await req.json();

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'rows array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (API_KEYS.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No CLAUDE_API_KEY configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format rows compactly for AI — truncate cells, limit columns
    const maxCols = Math.min(rows[0]?.length || 8, 10);
    const formattedRows = rows.map((row: any[], i: number) => {
      const cells = [];
      for (let c = 0; c < maxCols; c++) {
        const val = String(row[c] ?? '').trim().substring(0, 60);
        cells.push(val || '');
      }
      return `[${i}] ${cells.join(' | ')}`;
    }).join('\n');

    const prompt = `Przeanalizuj arkusz kalkulacyjny z polskiego kosztorysu budowlanego.

ARKUSZ: "${sheetName || 'Sheet1'}" (${rows.length} wierszy, ${maxCols} kolumn)

DANE:
${formattedRows}

ZADANIE: Zidentyfikuj strukturę tego arkusza — kolumny, wiersze nagłówkowe, działy, poddziały, pozycje i wiersze do zignorowania.

Zwróć TYLKO czysty JSON (bez markdown, bez komentarzy) w formacie:
{
  "columns": {
    "lp": <indeks kolumny z numerem porządkowym Lp, lub -1 jeśli brak>,
    "base": <indeks kolumny z numerem KNR/podstawą, lub -1>,
    "name": <indeks kolumny z opisem/nazwą pozycji, lub -1>,
    "unit": <indeks kolumny z jednostką miary (j.m.), lub -1>,
    "qty": <indeks kolumny z ilością, lub -1>
  },
  "headerRow": <indeks wiersza nagłówkowego (0-based)>,
  "structure": [
    { "row": <indeks wiersza 0-based>, "type": "dzial", "name": "nazwa działu" },
    { "row": <indeks wiersza 0-based>, "type": "poddzial", "name": "nazwa poddziału" },
    { "row": <indeks wiersza 0-based>, "type": "ignore", "reason": "powód ignorowania" }
  ]
}

ZASADY:
- "columns" — indeksy kolumn (0-based). Jeśli kolumna nie istnieje, ustaw -1
- "headerRow" — wiersz z nagłówkami kolumn (np. "Lp.", "Opis", "J.m.", "Ilość")
- KOLUMNA "base" (KNR): Ustaw TYLKO jeśli kolumna zawiera PRAWDZIWE numery KNR/KNNR w formacie typu "KNR 2-01 0101-01", "KNNR 5 0407-01". Kody typu "ST-", "KB-A-TS-", "SST", "OST" to NIE SĄ KNR — dla takich kolumn ustaw base na -1
- "structure" — lista WSZYSTKICH specjalnych wierszy (nie-pozycji):
  - "dzial" — nagłówek działu (główna kategoria prac)
  - "poddzial" — nagłówek poddziału (podkategoria w dziale)
  - "ignore" — wiersze do pominięcia: podsumowania ("Razem", "Suma", "Ogółem"), puste wiersze formatujące, dodatkowe nagłówki, wiersze z wartościami bez nazw pozycji
- HIERARCHIA: Każdy "poddzial" MUSI znajdować się po jakimś "dzial". Nie może być poddziału bez wcześniejszego działu. Jeśli widzisz strukturę hierarchiczną ale bez wyraźnych działów nadrzędnych — traktuj je jako "dzial", a podkategorie jako "poddzial"
- Zwykłe pozycje kosztorysowe NIE powinny pojawiać się w "structure"
- Wiersze sekcji (dział/poddział) zwykle: nie mają jednostki miary, nie mają ilości, mają opisową nazwę kategorii
- Wiersze podsumowań często zawierają: "Razem", "Suma", "Ogółem", "RAZEM", "Wartość"
- Numeracja: działy mogą mieć cyfry rzymskie (I, II, III) lub arabskie (1, 2, 3), poddziały — numerację hierarchiczną (1.1, 1.2, 2.1)
- WAŻNE: Przeanalizuj WSZYSTKIE ${rows.length} wierszy, nie pomiń żadnych sekcji czy podsumowań`;

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
          JSON.stringify({ error: 'AI analysis failed', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const claudeData = await claudeResponse.json();
      const textBlock = claudeData.content?.find((b: { type: string }) => b.type === 'text');
      const rawText = textBlock?.text || '{}';

      let jsonText = rawText.trim();
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonText = jsonMatch[1].trim();

      const analysis = JSON.parse(jsonText);

      return new Response(
        JSON.stringify({ success: true, data: analysis, keysAvailable: API_KEYS.length }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // All keys exhausted
    return new Response(
      JSON.stringify({ error: 'All API keys rate limited', details: lastError, keysAvailable: API_KEYS.length }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in xlsx-ai-analyze:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
