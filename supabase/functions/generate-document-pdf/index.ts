// Edge Function: generate-document-pdf
// Generates PDF from document template and data

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  document_id: string;
}

function sanitizeData(data: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    clean[key] = String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }
  return clean;
}

function renderTemplate(template: any, data: Record<string, string>): string {
  const safe = sanitizeData(data);
  const sections: Array<{ title?: string; body?: string }> = template.content ?? [];

  return sections
    .map((section) => {
      let body = section.body ?? '';
      for (const [key, value] of Object.entries(safe)) {
        body = body.replaceAll(`{{${key}}}`, value);
      }
      const title = section.title ? `<h2 style="color: #1e40af; margin-top: 24px; margin-bottom: 12px; font-size: 18px;">${section.title}</h2>` : '';
      return `${title}\n<p style="line-height: 1.6; margin-bottom: 12px;">${body}</p>`;
    })
    .join('\n\n');
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

    const { document_id } = await req.json() as RequestBody;

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

    // Get document with template
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*, document_templates(*)')
      .eq('id', document_id)
      .single();

    if (docError || !document) {
      return new Response(JSON.stringify({ error: 'Document not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user has access to this company
    const { data: employee } = await supabase
      .from('employees')
      .select('company_id')
      .eq('user_id', user.id)
      .single();

    if (employee?.company_id !== document.company_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Render HTML content
    const htmlContent = renderTemplate(document.document_templates, document.data || {});
    
    const fullHtml = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <title>${document.name}</title>
  <style>
    @page { margin: 2cm; }
    body { font-family: 'DejaVu Sans', Arial, sans-serif; font-size: 12pt; line-height: 1.6; color: #333; }
    h1 { color: #1e40af; font-size: 24px; margin-bottom: 20px; }
    h2 { color: #1e40af; margin-top: 24px; margin-bottom: 12px; font-size: 18px; }
    p { margin-bottom: 12px; text-align: justify; }
    .header { border-bottom: 2px solid #1e40af; padding-bottom: 10px; margin-bottom: 30px; }
    .footer { margin-top: 40px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10pt; color: #666; }
    .document-number { font-size: 10pt; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <div class="document-number">Nr dokumentu: ${document.number || '—'}</div>
    <h1>${document.name}</h1>
  </div>
  ${htmlContent}
  <div class="footer">
    Wygenerowano: ${new Date().toLocaleString('pl-PL')} | System MaxMaster
  </div>
</body>
</html>`;

    // For now, return the HTML as a data URL (in production, use a PDF generation library)
    // In a real implementation, you'd use Puppeteer, Playwright, or a PDF service
    const htmlBlob = new Blob([fullHtml], { type: 'text/html' });
    const htmlBase64 = btoa(await htmlBlob.text());
    
    // Store PDF path in document
    const pdfPath = `${document.company_id}/${new Date().getFullYear()}/${document.id}.pdf`;
    await supabase
      .from('documents')
      .update({ pdf_path: pdfPath })
      .eq('id', document_id);

    // Log event
    await supabase.rpc('log_document_event', {
      p_document_id: document_id,
      p_action: 'pdf_generated',
      p_actor_type: 'user',
      p_actor_id: user.id,
      p_metadata: { path: pdfPath },
    });

    // Return data URL for preview (in production, return signed URL to stored PDF)
    const url = `data:text/html;base64,${htmlBase64}`;

    return new Response(JSON.stringify({ url, path: pdfPath }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
