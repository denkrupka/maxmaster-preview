// Edge Function: analyze-document
// AI analysis of documents using Gemini

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  document_id: string;
  company_id: string;
  analysis_type: 'review' | 'risk' | 'summary' | 'clause_check';
  document_content: Record<string, any>;
  template_name: string;
}

const ANALYSIS_PROMPTS: Record<string, string> = {
  review: `Przeanalizuj poniższy dokument budowlany i wskaż:
1. Brakujące klauzule lub informacje
2. Niejasne sformułowania
3. Sugestie poprawy
4. Zgodność ze standardami branżowymi`,
  
  risk: `Przeanalizuj poniższy dokument pod kątem ryzyk:
1. Ryzyka prawne
2. Ryzyka finansowe
3. Ryzyka terminowe
4. Zalecenia zabezpieczeń`,
  
  summary: `Przygotuj zwięzłe podsumowanie dokumentu:
1. Główne punkty
2. Kluczowe daty i kwoty
3. Strony i ich obowiązki
4. Najważniejsze terminy`,
  
  clause_check: `Sprawdź klauzule dokumentu:
1. Zgodność z polskim prawem budowlanym
2. Standardowe klauzule umowne
3. Klauzule nietypowe lub ryzykowne
4. Rekomendacje prawne`,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { document_id, company_id, analysis_type, document_content, template_name } = await req.json() as RequestBody;

    // Get user from auth
    const { data: { user } } = await supabase.auth.getUser(
      req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
    );

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user belongs to company
    const { data: employee } = await supabase
      .from('employees')
      .select('company_id')
      .eq('user_id', user.id)
      .single();

    if (employee?.company_id !== company_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prepare prompt
    const basePrompt = ANALYSIS_PROMPTS[analysis_type] || ANALYSIS_PROMPTS.summary;
    const contentText = Object.entries(document_content)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    
    const prompt = `${basePrompt}\n\nTyp dokumentu: ${template_name}\n\nZawartość:\n${contentText}`;

    // Call Gemini API (you'll need to set GEMINI_API_KEY in env)
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    let analysisResult = '';

    if (geminiApiKey) {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );

      if (geminiResponse.ok) {
        const geminiData = await geminiResponse.json();
        analysisResult = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
    }

    // Fallback if no API key or API failed
    if (!analysisResult) {
      analysisResult = `Analiza dokumentu "${template_name}" (typ: ${analysis_type}):\n\n` +
        `Dokument zawiera ${Object.keys(document_content).length} pól.\n\n` +
        `Uwagi:\n- Dokument wymaga weryfikacji przez specjalistę\n- Zalecana jest kontrola prawna\n- Sprawdź zgodność z obowiązującymi przepisami`;
    }

    // Save analysis result
    const { data: analysis, error: insertError } = await supabase
      .from('document_ai_analyses')
      .insert({
        document_id,
        company_id,
        analysis_type,
        result: { text: analysisResult, prompt },
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Log event
    await supabase.rpc('log_document_event', {
      p_document_id: document_id,
      p_action: 'analyzed',
      p_actor_type: 'user',
      p_actor_id: user.id,
      p_metadata: { analysis_type, analysis_id: analysis.id },
    });

    return new Response(JSON.stringify({ result: { text: analysisResult }, id: analysis.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error analyzing document:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
