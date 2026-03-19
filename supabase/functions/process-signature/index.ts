import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, confirmed, signer_name } = await req.json()
    if (!token || !confirmed) {
      return new Response(JSON.stringify({ error: 'token and confirmed required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Найти токен
    const { data: tokenRow } = await supabase.from('signature_tokens')
      .select('*, signature_requests(*)').eq('token', token).is('used_at', null).single()

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: 'Token invalid or already used' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'Token expired' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // IP и User-Agent (data pewna)
    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown'
    const userAgent = req.headers.get('user-agent') || 'unknown'
    const signedAt = new Date().toISOString()

    // Отметить токен использованным
    await supabase.from('signature_tokens').update({ used_at: signedAt }).eq('id', tokenRow.id)

    // Обновить запрос на подпись
    await supabase.from('signature_requests').update({
      status: 'signed',
      signed_at: signedAt,
      ip_address: ipAddress,
      user_agent: userAgent,
    }).eq('id', tokenRow.request_id)

    const sigReq = tokenRow.signature_requests as any
    const documentId = sigReq?.document_id

    // Проверить все ли подписали (для sequential workflow)
    const { data: allRequests } = await supabase.from('signature_requests')
      .select('status, signing_order').eq('document_id', documentId).order('signing_order')

    const allSigned = allRequests?.every(r => r.status === 'signed')
    const pendingCount = allRequests?.filter(r => r.status === 'sent').length || 0

    // Если все подписали — обновить статус документа
    if (allSigned) {
      await supabase.from('documents').update({ status: 'signed' }).eq('id', documentId)
    }

    // Audit log с IP + UA (data pewna)
    await supabase.from('document_audit_log').insert({
      document_id: documentId,
      action: 'document_signed',
      actor_email: sigReq?.signer_email,
      metadata: {
        request_id: tokenRow.request_id,
        ip_address: ipAddress,
        user_agent: userAgent,
        signed_at: signedAt,
        signer_name: signer_name || sigReq?.signer_name,
        all_signed: allSigned,
        pending_signers: pendingCount,
      }
    })

    return new Response(JSON.stringify({
      success: true,
      signed_at: signedAt,
      ip_address: ipAddress,
      all_signed: allSigned,
      pending_signers: pendingCount,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
