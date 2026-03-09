import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Email templates
const EMAIL_TEMPLATES: Record<string, { subject: string; html: (data: any) => string }> = {
  MODULE_ACTIVATED: {
    subject: 'Modul zostal aktywowany - MaxMaster',
    html: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">MaxMaster</h1>
        </div>
        <div style="padding: 30px; background: #f8fafc;">
          <h2 style="color: #1e293b;">Modul ${data.moduleName} zostal aktywowany!</h2>
          <p style="color: #475569;">Witaj ${data.userName},</p>
          <p style="color: #475569;">Informujemy, ze modul <strong>${data.moduleName}</strong> zostal pomyslnie aktywowany dla firmy <strong>${data.companyName}</strong>.</p>
          <div style="background: white; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <p style="margin: 0; color: #64748b;"><strong>Liczba miejsc:</strong> ${data.seats}</p>
            <p style="margin: 10px 0 0; color: #64748b;"><strong>Cena miesieczna:</strong> ${data.price} PLN</p>
          </div>
          <a href="${data.dashboardUrl}" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 20px;">Przejdz do panelu</a>
        </div>
      </div>
    `
  },

  GENERIC: {
    subject: 'Powiadomienie - MaxMaster',
    html: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">MaxMaster</h1>
        </div>
        <div style="padding: 30px; background: #f8fafc;">
          <h2 style="color: #1e293b;">${data.title || ''}</h2>
          <p style="color: #475569;">${data.message || ''}</p>
          ${data.actionUrl ? `<a href="${data.actionUrl}" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 20px;">${data.actionText || 'Przejdz'}</a>` : ''}
        </div>
      </div>
    `
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const POSTMARK_API_KEY = Deno.env.get('POSTMARK_API_KEY')
    const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'MaxMaster <noreply@maxmaster.info>'

    if (!POSTMARK_API_KEY) {
      throw new Error('Email service not configured. Set POSTMARK_API_KEY in environment.')
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const body = await req.json()
    const { template, to, data, subject: customSubject, html: customHtml } = body

    console.log('Sending email via Postmark:', { template, to })

    if (!to) {
      throw new Error('Missing required field: to')
    }

    // Determine subject and html content
    let subject: string
    let html: string

    if (template === 'CUSTOM' && customHtml) {
      // Direct HTML content (used by offer sending)
      subject = customSubject || 'Powiadomienie - MaxMaster'
      html = customHtml
    } else {
      const emailTemplate = EMAIL_TEMPLATES[template] || EMAIL_TEMPLATES.GENERIC
      subject = customSubject || emailTemplate.subject
      html = emailTemplate.html(data || {})
    }

    // Send via Postmark
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Postmark-Server-Token': POSTMARK_API_KEY
      },
      body: JSON.stringify({
        From: EMAIL_FROM,
        To: Array.isArray(to) ? to.join(', ') : to,
        Subject: subject,
        HtmlBody: html,
        MessageStream: 'outbound'
      })
    })

    const result = await response.json()

    if (!response.ok || result.ErrorCode) {
      console.error('Postmark error:', result)
      throw new Error(result.Message || 'Failed to send email via Postmark')
    }

    // Log email sent
    try {
      await supabaseAdmin.from('email_logs').insert({
        recipient: Array.isArray(to) ? to.join(', ') : to,
        template: template || 'CUSTOM',
        subject,
        status: 'sent',
        provider_id: result.MessageID
      })
    } catch (logErr) {
      console.error('Failed to log email:', logErr)
    }

    return new Response(
      JSON.stringify({ success: true, id: result.MessageID }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    console.error('Email error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})
