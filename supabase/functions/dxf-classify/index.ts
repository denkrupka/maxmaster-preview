import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

interface LayerInput {
  name: string;
  entityCount: number;
  entityTypes: Record<string, number>;
}

interface BlockInput {
  name: string;
  insertCount: number;
  containedTypes: string[];
}

interface ClassificationResult {
  layers: { name: string; category: string; confidence: number }[];
  blocks: { name: string; category: string; description: string; confidence: number }[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { layers, blocks } = await req.json() as { layers: LayerInput[]; blocks: BlockInput[] }

    if (!layers?.length && !blocks?.length) {
      return new Response(
        JSON.stringify({ error: 'No layers or blocks provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const CLAUDE_API_KEY = Deno.env.get('CLAUDE_API_KEY')
    if (!CLAUDE_API_KEY) {
      throw new Error('Missing CLAUDE_API_KEY secret')
    }

    // Build the prompt for classification
    const layerList = layers.map(l =>
      `- "${l.name}" (${l.entityCount} elementów, typy: ${Object.entries(l.entityTypes).map(([t, c]) => `${t}:${c}`).join(', ')})`
    ).join('\n')

    const blockList = blocks.map(b =>
      `- "${b.name}" (${b.insertCount}x wstawiony, zawiera: ${b.containedTypes.join(', ')})`
    ).join('\n')

    const prompt = `Jesteś ekspertem od instalacji elektrycznych i rysunków technicznych DXF/AutoCAD.

Sklasyfikuj poniższe warstwy i bloki z rysunku DXF instalacji elektrycznej.

Dla każdej warstwy i bloku przypisz kategorię z poniższej listy:
- "Kable i przewody" — warstwy/bloki z kablami, przewodami, liniami kablowymi
- "Oprawy oświetleniowe" — oprawy, lampy, źródła światła
- "Osprzęt elektryczny" — gniazda, wyłączniki, łączniki, puszki
- "Trasy kablowe" — rury, koryta, kanały kablowe
- "Tablice i rozdzielnice" — tablice rozdzielcze, skrzynki, szafy
- "Instalacja alarmowa" — czujniki, detektory, sygnalizatory
- "Instalacja odgromowa" — zwody, przewody odprowadzające, uziomy
- "Wymiary i opisy" — warstwy z tekstem wymiarowym, opisami
- "Konstrukcja / architektura" — ściany, drzwi, okna, elementy budynku
- "Inne" — nie pasuje do żadnej kategorii

WARSTWY:
${layerList || '(brak)'}

BLOKI:
${blockList || '(brak)'}

Odpowiedz WYŁĄCZNIE w formacie JSON:
{
  "layers": [{"name": "...", "category": "...", "confidence": 0.0-1.0}],
  "blocks": [{"name": "...", "category": "...", "description": "krótki opis po polsku", "confidence": 0.0-1.0}]
}`

    console.log(`Classifying ${layers.length} layers, ${blocks.length} blocks`)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Claude API error:', response.status, errText)
      throw new Error(`Claude API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.content?.[0]?.text || ''

    // Extract JSON from response
    let result: ClassificationResult
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      result = JSON.parse(jsonMatch[0])
    } catch {
      console.error('Failed to parse Claude response:', content)
      throw new Error('Failed to parse AI classification result')
    }

    // Validate & normalize
    result.layers = (result.layers || []).map(l => ({
      name: l.name,
      category: l.category || 'Inne',
      confidence: Math.max(0, Math.min(1, l.confidence || 0.5)),
    }))

    result.blocks = (result.blocks || []).map(b => ({
      name: b.name,
      category: b.category || 'Inne',
      description: b.description || '',
      confidence: Math.max(0, Math.min(1, b.confidence || 0.5)),
    }))

    console.log(`Classification complete: ${result.layers.length} layers, ${result.blocks.length} blocks`)

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('dxf-classify error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
