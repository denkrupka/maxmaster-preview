import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { document_id, signer_email, signer_name, message } = await req.json()
    if (!document_id || !signer_email) {
      return new Response(JSON.stringify({ error: 'document_id and signer_email required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Получить документ
    const { data: doc } = await supabase.from('documents').select('title, content, company_id').eq('id', document_id).single()
    if (!doc) return new Response(JSON.stringify({ error: 'Document not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

    // Создать запрос на подпись
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: sigReq, error: sigErr } = await supabase.from('signature_requests').insert({
      document_id,
      signer_email,
      signer_name: signer_name || signer_email,
      status: 'sent',
      message: message || '',
      expires_at: expiresAt,
    }).select().single()
    if (sigErr) throw sigErr

    // Создать токен подписи
    const token = crypto.randomUUID() + '-' + crypto.randomUUID()
    await supabase.from('signature_tokens').insert({
      request_id: sigReq.id,
      token,
      expires_at: expiresAt,
    })

    // Ссылка для подписи
    const appUrl = Deno.env.get('APP_URL') || 'https://portal.maxmaster.info'
    const signUrl = `${appUrl}/#/sign/${token}`

    // Отправить через Postmark
    const postmarkApiKey = Deno.env.get('POSTMARK_API_KEY') || Deno.env.get('POSTMARK_SERVER_TOKEN')
    if (!postmarkApiKey) throw new Error('POSTMARK_API_KEY not configured')

    const emailResponse = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': postmarkApiKey,
      },
      body: JSON.stringify({
        From: 'noreply@maxmaster.info',
        To: signer_email,
        Subject: `Prośba o podpis dokumentu: ${doc.title}`,
        HtmlBody: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1e40af;">Prośba o podpis dokumentu</h2>
            <p>Cześć${signer_name ? ' ' + signer_name : ''},</p>
            <p>Proszę o podpisanie dokumentu: <strong>${doc.title}</strong></p>
            ${message ? `<p style="background: #f1f5f9; padding: 12px; border-radius: 6px; color: #475569;">${message}</p>` : ''}
            <p>Kliknij przycisk poniżej, aby przejrzeć i podpisać dokument:</p>
            <a href="${signUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
              Podpisz dokument
            </a>
            <p style="color: #6b7280; font-size: 14px;">Link ważny do: ${new Date(expiresAt).toLocaleDateString('pl-PL')}</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
            <p style="color: #9ca3af; font-size: 12px;">MaxMaster — system zarządzania budową</p>
          </div>
        `,
        TextBody: `Prośba o podpis dokumentu: ${doc.title}\n\nLink do podpisania: ${signUrl}\n\nLink ważny do: ${new Date(expiresAt).toLocaleDateString('pl-PL')}`,
        MessageStream: 'outbound',
      }),
    })

    const emailResult = await emailResponse.json()
    if (!emailResponse.ok) throw new Error(`Postmark error: ${JSON.stringify(emailResult)}`)

    // Лог
    await supabase.from('document_audit_log').insert({
      document_id,
      action: 'signature_requested',
      actor_email: signer_email,
      metadata: { request_id: sigReq.id, message_id: emailResult.MessageID },
    })

    // Обновить статус документа
    await supabase.from('documents').update({ status: 'sent' }).eq('id', document_id)

    return new Response(JSON.stringify({
      success: true,
      request_id: sigReq.id,
      sign_url: signUrl,
      email_sent: true,
      message_id: emailResult.MessageID,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
