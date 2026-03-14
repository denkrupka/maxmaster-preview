// Edge Function: generate-document-number
// Генерирует автоинкрементный номер документа по настройкам компании.
//
// Принимает: { template_type, project_id? }
//
// Логика сборки номера:
//   parts = [prefix]
//   if (includeProjectCode && project_id) {
//     parts.push(projectCode)          // код объекта УЖЕ содержит год
//     if (includeMonth) parts.push(MM)
//   } else {
//     parts.push(YYYY)
//     if (includeMonth) parts.push(MM)
//   }
//   parts.push(paddedNumber)
//
// Примеры:
//   Базовый:          CON/2026/001
//   + месяц:          CON/2026/03/001
//   + код объекта:    CON/ZD-II/001
//   + оба:            CON/ZD-II/03/001

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const TYPE_PREFIX: Record<string, string> = {
  contract: 'CON',
  protocol: 'PRO',
  annex: 'ANX',
  other: 'DOC',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: userData } = await userClient
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (!userData?.company_id) {
      return new Response(JSON.stringify({ error: 'No company' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { template_type, project_id } = await req.json()
    const companyId = userData.company_id
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')

    // --- Admin client ---
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // --- Загружаем настройки нумерации ---
    const { data: settingsRow } = await adminClient
      .from('document_settings')
      .select('numbering_config')
      .eq('company_id', companyId)
      .single()

    const allConfig = settingsRow?.numbering_config as Record<string, any> | null
    const typeConfig = allConfig?.[template_type] ?? null

    const prefix: string = typeConfig?.prefix ?? TYPE_PREFIX[template_type] ?? 'DOC'
    const separator: string = typeConfig?.separator ?? '/'
    const digits: number = typeConfig?.digits ?? 3
    const includeProjectCode: boolean = typeConfig?.includeProjectCode === true
    const includeMonth: boolean = typeConfig?.includeMonth === true

    // --- Код проекта (если нужен) ---
    let projectCode: string | null = null
    if (includeProjectCode && project_id) {
      const { data: projectData } = await adminClient
        .from('projects')
        .select('code')
        .eq('id', project_id)
        .single()
      projectCode = projectData?.code ?? null
    }

    // --- Атомарный инкремент ---
    const { data: updated } = await adminClient.rpc('exec_sql', {
      query: `UPDATE document_numbering
              SET last_number = last_number + 1
              WHERE company_id = '${companyId}' AND prefix = '${prefix}' AND year = ${year}
              RETURNING last_number`
    }).single()

    let nextNumber: number

    if (updated?.last_number) {
      nextNumber = updated.last_number
    } else {
      // Fallback: upsert без RPC
      const { data: existing } = await adminClient
        .from('document_numbering')
        .select('id, last_number')
        .eq('company_id', companyId)
        .eq('prefix', prefix)
        .eq('year', year)
        .single()

      if (existing) {
        nextNumber = existing.last_number + 1
        await adminClient
          .from('document_numbering')
          .update({ last_number: nextNumber })
          .eq('id', existing.id)
      } else {
        nextNumber = 1
        await adminClient
          .from('document_numbering')
          .insert({ company_id: companyId, prefix, year, last_number: 1 })
      }
    }

    // --- Сборка номера ---
    const parts: string[] = [prefix]

    if (projectCode) {
      // Код объекта УЖЕ содержит год → НЕ добавляем year отдельно
      parts.push(projectCode)
      if (includeMonth) parts.push(month)
    } else {
      // Без кода объекта → год обязателен
      parts.push(String(year))
      if (includeMonth) parts.push(month)
    }

    parts.push(String(nextNumber).padStart(digits, '0'))

    const number = parts.join(separator)

    return new Response(JSON.stringify({ number }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
