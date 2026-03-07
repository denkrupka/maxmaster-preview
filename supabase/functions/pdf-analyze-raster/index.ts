// Supabase Edge Function: Analyze PDF drawing with Claude Vision (Anthropic)
// Returns structured bill-of-materials with approximate element positions

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

    const systemPrompt = `You are an expert electrical installation drawing analyzer. Your task is to analyze a technical drawing and produce an accurate bill of materials (przedmiar).

STRICT RULES — FOLLOW EXACTLY:

1. **LEGEND IS YOUR GROUND TRUTH.** Read the legend (LEGENDA) on the drawing FIRST. Every element you report MUST correspond to an entry in the legend. Use the EXACT names and descriptions from the legend — do not paraphrase, do not generalize.

2. **DO NOT INVENT ELEMENTS.** Only report elements you can actually SEE on the drawing. If you cannot clearly identify a cable route line on the drawing, do NOT add cables/routes. If the drawing shows only lighting fixtures and switches — report only those.

3. **COUNT PRECISELY.** Go room by room, section by section. Count each symbol type separately. If the legend shows "AW1" for emergency lighting — count every "AW1" symbol on the plan, not an estimate.

4. **REPORT POSITIONS.** For each symbol occurrence, estimate its approximate position as percentage coordinates (0-100% of image width/height, where 0,0 is top-left). This enables highlighting on the drawing.

5. **CABLE ROUTES — ONLY IF VISIBLE.** Only report cable routes if you see actual drawn cable lines (usually colored/thick lines running between elements with cable type annotations like "YDYp 3x2.5"). Electrical connection lines between symbols on a floor plan are NOT cable routes.

6. **USE POLISH TERMINOLOGY** from the legend exactly as written.

Process:
1. Read the legend completely — list every entry
2. For each legend entry, scan the drawing and count occurrences
3. Record approximate positions of each occurrence
4. Only add cable routes if explicitly drawn and annotated
5. Output JSON`;

    const userPrompt = `Analyze this technical drawing (page ${pageNumber || 1}).

${ocrContext ? `Additional context:\n${ocrContext}` : ''}

Output valid JSON inside <json> tags with this EXACT structure:

{
  "drawingType": "type of drawing",
  "scaleText": "1:100" or null,
  "symbols": [
    {
      "type": "EXACT name from legend (e.g. 'Oprawa oświetleniowa LUXCLASSIC SLIM LED 60x600')",
      "legendRef": "legend symbol code if present (e.g. 'AW1', 'AE-1')",
      "category": "Oprawy oświetleniowe | Osprzęt elektryczny | Wyłączniki | Tablice rozdzielcze | Instalacja alarmowa | Instalacja teletechniczna | Inne",
      "count": number,
      "description": "full description from legend",
      "positions": [{"x": 0-100, "y": 0-100}, ...]
    }
  ],
  "routes": [
    {
      "type": "cable spec ONLY if visible on drawing",
      "category": "Kable i przewody",
      "estimatedLengthM": number,
      "description": "route description"
    }
  ],
  "legendEntries": [
    {
      "symbol": "symbol code/graphic description",
      "description": "full text from legend",
      "category": "category"
    }
  ]
}

REMEMBER:
- "positions" is an array of {x, y} percentage coordinates (0-100) for EACH occurrence of that symbol on the drawing
- Every symbol "type" must match a legend entry EXACTLY
- Do NOT add routes/cables unless you see actual cable route lines drawn on the plan
- Count each symbol occurrence individually and precisely`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16384,
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
    const textContent = claudeData.content?.find((c: any) => c.type === 'text')?.text || '{}';

    // Parse JSON from <json> tags, ```json blocks, or raw
    let jsonStr = '';
    const jsonTagMatch = textContent.match(/<json>\s*([\s\S]*?)\s*<\/json>/);
    if (jsonTagMatch) {
      jsonStr = jsonTagMatch[1].trim();
    } else {
      const codeBlockMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      } else {
        const rawMatch = textContent.match(/\{[\s\S]*\}/);
        jsonStr = rawMatch ? rawMatch[0] : '{}';
      }
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
