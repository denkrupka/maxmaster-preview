import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const { document_id, signer_email, signer_name, role, message, expires_at } = await req.json()
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  // 1. Создать signature_request
  const { data: request, error: reqError } = await supabase
    .from('signature_requests')
    .insert({ document_id, signer_email, signer_name, role: role || 'signer', message, expires_at, status: 'sent' })
    .select()
    .single()
  
  if (reqError) return new Response(JSON.stringify({ error: reqError.message }), { status: 400 })
  
  // 2. Создать signature_token
  const { data: tokenData } = await supabase
    .from('signature_tokens')
    .insert({ request_id: request.id })
    .select()
    .single()
  
  // 3. Получить данные документа
  const { data: doc } = await supabase
    .from('documents')
    .select('title, company_id')
    .eq('id', document_id)
    .single()
  
  // 4. Отправить email (через Resend или просто залогировать)
  const signUrl = `${Deno.env.get('APP_URL') || 'https://portal.maxmaster.info'}/#/sign/${tokenData.token}`
  
  console.log(`Sign URL for ${signer_email}: ${signUrl}`)
  
  // TODO: Resend email когда будет API ключ
  // await fetch('https://api.resend.com/emails', { ... })
  
  // 5. Audit log
  await supabase.from('document_audit_log').insert({
    document_id,
    action: 'signature_requested',
    actor_email: signer_email,
    metadata: { signer_email, role, sign_url: signUrl }
  })
  
  return new Response(JSON.stringify({ 
    success: true, 
    request_id: request.id,
    sign_url: signUrl 
  }), { 
    headers: { 'Content-Type': 'application/json' }
  })
})
