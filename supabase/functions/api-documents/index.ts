// REST API for document management
// Endpoint: /api/v1/documents
// Authentication: API Key

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

interface ApiKeyData {
  id: string;
  company_id: string;
  name: string;
  permissions: string[];
  is_active: boolean;
  expires_at?: string;
}

// Verify API Key
async function verifyApiKey(supabase: any, apiKey: string): Promise<ApiKeyData | null> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key_hash', apiKey)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;
  
  // Check expiration
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return null;
  }
  
  return data;
}

// Log API request
async function logApiRequest(supabase: any, apiKeyId: string, endpoint: string, method: string, statusCode: number, responseTime: number) {
  await supabase.from('api_request_logs').insert([{
    api_key_id: apiKeyId,
    endpoint,
    method,
    status_code: statusCode,
    response_time_ms: responseTime,
  }]);
}

// Create document
async function createDocument(supabase: any, companyId: string, body: any) {
  const {
    title,
    content,
    type = 'custom',
    recipient_email,
    recipient_name,
    metadata = {},
  } = body;

  if (!title || !content) {
    return { error: 'Title and content are required', status: 400 };
  }

  const { data, error } = await supabase
    .from('documents_api')
    .insert([{
      company_id: companyId,
      title,
      content,
      type,
      recipient_email,
      recipient_name,
      metadata,
      status: 'draft',
      created_at: new Date().toISOString(),
    }])
    .select()
    .single();

  if (error) {
    console.error('Error creating document:', error);
    return { error: 'Failed to create document', status: 500 };
  }

  return { data, status: 201 };
}

// Get document by ID
async function getDocument(supabase: any, companyId: string, documentId: string) {
  const { data, error } = await supabase
    .from('documents_api')
    .select('*')
    .eq('id', documentId)
    .eq('company_id', companyId)
    .single();

  if (error || !data) {
    return { error: 'Document not found', status: 404 };
  }

  return { data, status: 200 };
}

// List documents
async function listDocuments(supabase: any, companyId: string, query: URLSearchParams) {
  let dbQuery = supabase
    .from('documents_api')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  // Filter by status
  const status = query.get('status');
  if (status) {
    dbQuery = dbQuery.eq('status', status);
  }

  // Filter by type
  const type = query.get('type');
  if (type) {
    dbQuery = dbQuery.eq('type', type);
  }

  // Pagination
  const limit = parseInt(query.get('limit') || '20');
  const offset = parseInt(query.get('offset') || '0');
  dbQuery = dbQuery.range(offset, offset + limit - 1);

  const { data, error, count } = await dbQuery;

  if (error) {
    console.error('Error listing documents:', error);
    return { error: 'Failed to list documents', status: 500 };
  }

  return { 
    data: {
      documents: data,
      pagination: {
        limit,
        offset,
        total: count,
      },
    },
    status: 200 
  };
}

// Send document for signing
async function sendForSigning(supabase: any, companyId: string, documentId: string) {
  // Get document
  const { data: doc, error: docError } = await supabase
    .from('documents_api')
    .select('*')
    .eq('id', documentId)
    .eq('company_id', companyId)
    .single();

  if (docError || !doc) {
    return { error: 'Document not found', status: 404 };
  }

  if (!doc.recipient_email) {
    return { error: 'Document has no recipient email', status: 400 };
  }

  // Update status
  const { error: updateError } = await supabase
    .from('documents_api')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .eq('id', documentId);

  if (updateError) {
    return { error: 'Failed to send document', status: 500 };
  }

  // Trigger webhook if configured
  await triggerWebhook(supabase, companyId, 'document.sent', {
    document_id: documentId,
    recipient_email: doc.recipient_email,
    sent_at: new Date().toISOString(),
  });

  return { 
    data: { 
      message: 'Document sent for signing',
      document_id: documentId,
      status: 'sent',
    },
    status: 200 
  };
}

// Trigger webhook
async function triggerWebhook(supabase: any, companyId: string, event: string, payload: any) {
  const { data: webhooks } = await supabase
    .from('webhooks')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .contains('events', [event]);

  if (!webhooks || webhooks.length === 0) return;

  for (const webhook of webhooks) {
    try {
      await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhook.secret || '',
        },
        body: JSON.stringify({
          event,
          timestamp: new Date().toISOString(),
          data: payload,
        }),
      });

      // Log success
      await supabase.from('webhook_logs').insert([{
        webhook_id: webhook.id,
        event,
        payload,
        status: 'success',
      }]);
    } catch (error) {
      console.error('Webhook error:', error);
      // Log failure
      await supabase.from('webhook_logs').insert([{
        webhook_id: webhook.id,
        event,
        payload,
        status: 'failed',
        error: error.message,
      }]);
    }
  }
}

// Main handler
serve(async (req) => {
  const startTime = Date.now();
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get API Key from header
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify API Key
    const apiKeyData = await verifyApiKey(supabase, apiKey);
    if (!apiKeyData) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse URL and path
    const url = new URL(req.url);
    const path = url.pathname.replace('/api/v1', '');
    const pathParts = path.split('/').filter(Boolean);

    let result;

    // Route handling
    if (pathParts[0] === 'documents') {
      if (req.method === 'POST' && pathParts.length === 1) {
        // Create document
        const body = await req.json();
        result = await createDocument(supabase, apiKeyData.company_id, body);
      } else if (req.method === 'GET' && pathParts.length === 1) {
        // List documents
        result = await listDocuments(supabase, apiKeyData.company_id, url.searchParams);
      } else if (req.method === 'GET' && pathParts.length === 2) {
        // Get single document
        result = await getDocument(supabase, apiKeyData.company_id, pathParts[1]);
      } else if (req.method === 'POST' && pathParts.length === 3 && pathParts[2] === 'send') {
        // Send for signing
        result = await sendForSigning(supabase, apiKeyData.company_id, pathParts[1]);
      } else {
        result = { error: 'Not found', status: 404 };
      }
    } else {
      result = { error: 'Not found', status: 404 };
    }

    const responseTime = Date.now() - startTime;
    
    // Log API request
    await logApiRequest(
      supabase,
      apiKeyData.id,
      url.pathname,
      req.method,
      result.status || 200,
      responseTime
    );

    return new Response(
      JSON.stringify(result.data || { error: result.error }),
      { 
        status: result.status || 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
