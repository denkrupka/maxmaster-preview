// Edge Function: log-document-event
// Logs document events to audit log (SECURITY DEFINER)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  document_id: string;
  action: string;
  metadata?: Record<string, any>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { document_id, action, metadata } = await req.json() as RequestBody;

    // Get user from auth
    const { data: { user } } = await supabase.auth.getUser(
      req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
    );

    // Get document to determine company_id
    const { data: document } = await supabase
      .from('documents')
      .select('company_id, name')
      .eq('id', document_id)
      .single();

    if (!document) {
      return new Response(JSON.stringify({ error: 'Document not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get actor info
    let actorName = 'System';
    if (user) {
      const { data: employee } = await supabase
        .from('employees')
        .select('first_name, last_name')
        .eq('user_id', user.id)
        .single();
      actorName = employee ? `${employee.first_name} ${employee.last_name}` : 'Unknown';
    }

    // Insert audit log entry using RPC (SECURITY DEFINER)
    const { error: logError } = await supabase.rpc('log_document_event', {
      p_document_id: document_id,
      p_action: action,
      p_actor_type: user ? 'user' : 'system',
      p_actor_id: user?.id || null,
      p_actor_name: actorName,
      p_metadata: metadata || {},
    });

    if (logError) throw logError;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error logging event:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
