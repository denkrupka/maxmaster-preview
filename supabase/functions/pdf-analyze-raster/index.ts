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

    const systemPrompt = `You are an expert electrical installation drawing analyzer. Your task is to analyze technical drawings of electrical installations and extract a comprehensive, accurate bill of materials (przedmiar) that can be used for project automation and cost estimation.

Before providing your final JSON output, use a scratchpad to think through your analysis systematically:

<scratchpad>
In your scratchpad, work through the following steps:

1. **Identify the drawing type**: Determine what type of electrical installation this is (lighting, outlets, distribution board schematic, etc.)

2. **Locate and interpret the legend**: Find any legend or symbol key on the drawing. List out what each symbol represents according to the legend.

3. **Locate the scale**: Find the scale notation (e.g., "1:100", "1:50") which will be crucial for estimating cable lengths.

4. **Count symbols systematically**: Go through the drawing methodically (e.g., room by room, or section by section) and count each type of electrical symbol. Be precise - recount if necessary. Distinguish between:
   - Different types of lighting fixtures (LED, fluorescent, emergency, outdoor, etc.)
   - Different types of outlets (230V standard, 230V with ground, DATA/RJ45, TV/SAT, etc.)
   - Different types of switches (single, double, staircase/two-way, dimmer, etc.)
   - Junction boxes, distribution boards, and other components

5. **Identify cable routes**: Trace each cable or wire path shown on the drawing. Note:
   - Cable type/specification (e.g., "YDYp 3x2.5mm²", "YKY 5x10mm²")
   - Approximate length based on the scale and route path
   - Whether cables run in conduit, on surface, or underground

6. **Cross-reference with OCR text**: Use the OCR text to verify symbol counts, cable specifications, and any annotations you might have missed visually.

7. **Categorize everything**: Group elements into logical categories (Lighting Fixtures, Outlets, Switches, Cables, Distribution Equipment, Other)
</scratchpad>

After your analysis, provide your output in valid JSON format inside <json> tags.

**CRITICAL REQUIREMENTS:**

1. **Accuracy is paramount**: This output will be used for automated cost estimation and material ordering. Count every symbol precisely. If you're unsure about a count, recount that element type.

2. **Distinguish element types carefully**:
   - Different wattages of LED fixtures are different types
   - Single vs. double outlets are different types
   - Single vs. double vs. staircase switches are different types
   - Shielded vs. unshielded cables are different types

3. **Use the legend**: If a legend is present on the drawing, it is your primary reference for identifying symbols. Cross-reference every symbol you count with the legend.

4. **Estimate cable lengths realistically**:
   - Use the scale to measure routes
   - Add 10-15% for vertical runs, connections, and waste
   - If scale is unclear, note this in the description

5. **Be comprehensive**: Include ALL elements visible on the drawing:
   - Main components (lights, outlets, switches)
   - Supporting components (junction boxes, conduits, cable trays)
   - Distribution equipment (panels, breakers, disconnects)
   - Special elements (emergency lighting, motion sensors, timers)

6. **Use consistent Polish terminology**:
   - "Oprawa oświetleniowa" not just "lampa"
   - "Gniazdo wtykowe" not just "gniazdko"
   - "Wyłącznik" with specific type (pojedynczy, podwójny, schodowy)

7. **Provide complete specifications**: When visible, include:
   - Power ratings (W, kW)
   - Voltage ratings (230V, 400V)
   - Wire cross-sections (mm²)
   - Number of poles/circuits

The goal is to produce a bill of materials so detailed and accurate that it can be directly used for procurement and installation without requiring manual verification of the drawing.`;

    const userPrompt = `Analyze this technical electrical installation drawing (page ${pageNumber || 1}).

Here is the OCR text extracted from the drawing:
<ocr_text>
${ocrContext || 'No OCR text available'}
</ocr_text>

Provide your complete analysis now. Remember to use <scratchpad> first, then output JSON inside <json> tags with this structure:

{
  "drawingType": "string describing the type of installation drawing",
  "scaleText": "scale notation found on drawing or null",
  "symbols": [
    {
      "type": "specific element name",
      "category": "category name",
      "count": number,
      "description": "optional details"
    }
  ],
  "routes": [
    {
      "type": "cable specification",
      "category": "Kable i przewody",
      "estimatedLengthM": number,
      "description": "optional route description"
    }
  ],
  "legendEntries": [
    {
      "symbol": "symbol from legend",
      "description": "meaning from legend",
      "category": "category"
    }
  ]
}`;

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

    // Extract text content from Claude response
    const textContent = claudeData.content?.find((c: any) => c.type === 'text')?.text || '{}';

    // Parse JSON from <json> tags first, then fallback to ```json blocks, then raw
    let jsonStr = '';
    const jsonTagMatch = textContent.match(/<json>\s*([\s\S]*?)\s*<\/json>/);
    if (jsonTagMatch) {
      jsonStr = jsonTagMatch[1].trim();
    } else {
      const codeBlockMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      } else {
        // Try to find raw JSON object
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
