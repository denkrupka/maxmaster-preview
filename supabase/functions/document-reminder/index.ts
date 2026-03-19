import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
serve(async (_req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tomorrow = new Date(Date.now() + 48*60*60*1000).toISOString()
  const now = new Date().toISOString()
  const { data: expiring } = await supabase.from('signature_requests')
    .select('*, documents(title)').eq('status','sent').lte('expires_at',tomorrow).gte('expires_at',now)
  let sent = 0
  for (const req of expiring ?? []) {
    const { data: t } = await supabase.from('signature_tokens').select('token')
      .eq('request_id',req.id).is('used_at',null).single()
    if (!t) continue
    const url = (Deno.env.get('APP_URL')||'https://portal.maxmaster.info')+'/#/sign/'+t.token
    await supabase.from('document_audit_log').insert({document_id:req.document_id,action:'reminder_sent',actor_email:req.signer_email,metadata:{sign_url:url}})
    sent++
  }
  const { data: expired } = await supabase.from('documents').update({status:'expired'}).lt('expires_at',now).in('status',['sent','in_review']).select('id')
  return new Response(JSON.stringify({reminders_sent:sent,expired_count:expired?.length??0}),{headers:{'Content-Type':'application/json'}})
})
