// Edge Function: generate-document-number
// Generates unique document numbers with atomic increment

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  template_type: string;
  project_id?: string;
}

const TYPE_PREFIXES: Record<string, string> = {
  contract: 'CON',
  protocol: 'PRO',
  annex: 'ANX',
  other: 'DOC',
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

    const { template_type, project_id } = await req.json() as RequestBody;
    
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

    // Get user's company_id
    const { data: employee } = await supabase
      .from('employees')
      .select('company_id')
      .eq('user_id', user.id)
      .single();

    if (!employee?.company_id) {
      return new Response(JSON.stringify({ error: 'Company not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const companyId = employee.company_id;
    const prefix = TYPE_PREFIXES[template_type] || 'DOC';
    const year = new Date().getFullYear();

    // Atomic increment using RPC or direct SQL
    const { data: numbering, error: numberingError } = await supabase
      .from('document_numbering')
      .select('last_number')
      .eq('company_id', companyId)
      .eq('prefix', prefix)
      .eq('year', year)
      .single();

    let nextNumber: number;

    if (numberingError && numberingError.code === 'PGRST116') {
      // No record exists, create one
      nextNumber = 1;
      await supabase.from('document_numbering').insert({
        company_id: companyId,
        prefix,
        year,
        last_number: 1,
      });
    } else if (numberingError) {
      throw numberingError;
    } else {
      // Increment existing
      nextNumber = (numbering?.last_number || 0) + 1;
      const { error: updateError } = await supabase
        .from('document_numbering')
        .update({ last_number: nextNumber })
        .eq('company_id', companyId)
        .eq('prefix', prefix)
        .eq('year', year);
      
      if (updateError) throw updateError;
    }

    // Format: PREFIX/YEAR/NNN
    const number = `${prefix}/${year}/${String(nextNumber).padStart(3, '0')}`;

    return new Response(JSON.stringify({ number }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error generating document number:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
