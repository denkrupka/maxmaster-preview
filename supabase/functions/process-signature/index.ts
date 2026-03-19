import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const { token, signature_data } = await req.json()
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  const user_agent = req.headers.get('user-agent') || ''
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  // 1. Найти токен
  const { data: tokenData, error } = await supabase
    .from('signature_tokens')
    .select('*, signature_requests(*)')
    .eq('token', token)
    .is('used_at', null)
    .single()
  
  if (error || !tokenData) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 400 })
  }
  
  // 2. Обновить токен
  await supabase.from('signature_tokens').update({
    used_at: new Date().toISOString(),
    ip_address: ip,
    user_agent,
    signature_data: signature_data || 'confirmed'
  }).eq('id', tokenData.id)
  
  // 3. Обновить request
  await supabase.from('signature_requests').update({
    status: 'signed'
  }).eq('id', tokenData.request_id)
  
  const request = tokenData.signature_requests
  
  // 4. Проверить — все подписали?
  const { data: pending } = await supabase
    .from('signature_requests')
    .select('id')
    .eq('document_id', request.document_id)
    .eq('status', 'pending')
  
  if (!pending || pending.length === 0) {
    await supabase.from('documents').update({ status: 'signed' }).eq('id', request.document_id)
  }
  
  // 5. Audit log
  await supabase.from('document_audit_log').insert({
    document_id: request.document_id,
    action: 'signed',
    actor_email: request.signer_email,
    metadata: { ip, token }
  })
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
