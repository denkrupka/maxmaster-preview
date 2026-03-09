import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APS_BASE = 'https://developer.api.autodesk.com'
const BUCKET_KEY = 'maxmaster-drawings'

// ── Helpers ───────────────────────────────────────────────

async function getToken(): Promise<string> {
  const clientId = Deno.env.get('AUTODESK_CLIENT_ID')
  const clientSecret = Deno.env.get('AUTODESK_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('Missing Autodesk credentials')

  const res = await fetch(`${APS_BASE}/authentication/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'data:read data:write data:create bucket:read bucket:create',
    }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`APS auth failed (${res.status}): ${txt}`)
  }
  return (await res.json()).access_token
}

async function ensureBucket(token: string) {
  const check = await fetch(`${APS_BASE}/oss/v2/buckets/${BUCKET_KEY}/details`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (check.ok) return

  const create = await fetch(`${APS_BASE}/oss/v2/buckets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-ads-region': 'US',
    },
    body: JSON.stringify({ bucketKey: BUCKET_KEY, access: 'full', policyKey: 'transient' }),
  })
  if (!create.ok && create.status !== 409) {
    throw new Error(`Failed to create bucket: ${await create.text()}`)
  }
}

// ── Core Actions ──────────────────────────────────────────

async function handleGetToken() {
  return { access_token: await getToken() }
}

async function handleUpload(token: string, body: any) {
  const { fileBase64, fileName } = body
  if (!fileBase64 || !fileName) throw new Error('fileBase64 and fileName required')

  await ensureBucket(token)

  const binaryStr = atob(fileBase64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

  const objectKey = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  // Signed S3 upload
  const signedRes = await fetch(
    `${APS_BASE}/oss/v2/buckets/${BUCKET_KEY}/objects/${encodeURIComponent(objectKey)}/signeds3upload`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (signedRes.ok) {
    const signedData = await signedRes.json()
    const uploadUrl = signedData.urls?.[0]
    if (uploadUrl) {
      const s3Res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      if (!s3Res.ok) throw new Error(`S3 upload failed: ${s3Res.status}`)

      const completeRes = await fetch(
        `${APS_BASE}/oss/v2/buckets/${BUCKET_KEY}/objects/${encodeURIComponent(objectKey)}/signeds3upload`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadKey: signedData.uploadKey }),
        }
      )
      if (!completeRes.ok) throw new Error(`Complete upload failed: ${await completeRes.text()}`)

      const completeData = await completeRes.json()
      const urn = btoa(completeData.objectId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return { urn, objectKey, objectId: completeData.objectId }
    }
  }

  // Fallback: direct PUT
  const uploadRes = await fetch(
    `${APS_BASE}/oss/v2/buckets/${BUCKET_KEY}/objects/${encodeURIComponent(objectKey)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) },
      body: bytes,
    }
  )
  if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`)

  const uploadData = await uploadRes.json()
  const urn = btoa(uploadData.objectId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return { urn, objectKey, objectId: uploadData.objectId }
}

async function handleTranslate(token: string, body: any) {
  const { urn } = body
  if (!urn) throw new Error('urn required')

  const res = await fetch(`${APS_BASE}/modelderivative/v2/designdata/job`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-ads-force': 'true',
    },
    body: JSON.stringify({
      input: { urn },
      output: { formats: [{ type: 'svf2', views: ['2d', '3d'] }], destination: { region: 'us' } },
    }),
  })
  if (!res.ok) throw new Error(`Translation failed: ${await res.text()}`)
  return { result: (await res.json()).result, urn }
}

async function handleStatus(token: string, body: any) {
  const { urn } = body
  if (!urn) throw new Error('urn required')

  const res = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${urn}/manifest`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Status check failed: ${await res.text()}`)
  const data = await res.json()
  return { status: data.status, progress: data.progress, hasThumbnail: data.hasThumbnail, derivatives: data.derivatives }
}

async function handleDelete(token: string, body: any) {
  const { urn } = body
  if (!urn) throw new Error('urn required')
  await fetch(`${APS_BASE}/modelderivative/v2/designdata/${urn}/manifest`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  return { deleted: true }
}

// ── Model Properties — Object Tree ───────────────────────

async function handleGetModelTree(token: string, body: any) {
  const { urn, guid } = body
  if (!urn) throw new Error('urn required')

  // If no GUID provided, get the first viewable GUID
  let viewableGuid = guid
  if (!viewableGuid) {
    const manifest = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${urn}/manifest`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!manifest.ok) throw new Error('Failed to get manifest')
    const mData = await manifest.json()
    // Find first geometry derivative
    for (const d of mData.derivatives || []) {
      for (const c of d.children || []) {
        if (c.type === 'geometry') { viewableGuid = c.guid; break }
      }
      if (viewableGuid) break
    }
  }

  if (!viewableGuid) throw new Error('No viewable GUID found')

  // Get object tree with retries (may return 202 while processing)
  let attempts = 0
  while (attempts < 10) {
    const res = await fetch(
      `${APS_BASE}/modelderivative/v2/designdata/${urn}/metadata/${viewableGuid}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (res.status === 200) {
      const data = await res.json()
      return { guid: viewableGuid, objects: data.data?.objects || [] }
    }
    if (res.status === 202) {
      // Still processing
      await new Promise(r => setTimeout(r, 2000))
      attempts++
      continue
    }
    throw new Error(`Object tree failed (${res.status}): ${await res.text()}`)
  }
  throw new Error('Object tree extraction timed out')
}

// ── Model Properties — All Properties ────────────────────

async function handleGetAllProperties(token: string, body: any) {
  const { urn, guid } = body
  if (!urn) throw new Error('urn required')

  // Get GUID if not provided
  let viewableGuid = guid
  if (!viewableGuid) {
    const treeResult = await handleGetModelTree(token, { urn })
    viewableGuid = treeResult.guid
  }

  // Get all properties with retries
  let attempts = 0
  while (attempts < 10) {
    const res = await fetch(
      `${APS_BASE}/modelderivative/v2/designdata/${urn}/metadata/${viewableGuid}/properties?forceget=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (res.status === 200) {
      const data = await res.json()
      const collection = data.data?.collection || []

      // Transform into our ModelElement format
      const elements = collection.map((obj: any) => {
        const props: Record<string, any> = {}
        let category = '', family = '', type = '', layer = '', level = ''
        let length = 0, area = 0, volume = 0
        let blockName = '', system = '', classification = ''

        for (const group of Object.values(obj.properties || {})) {
          const g = group as any
          for (const [key, val] of Object.entries(g || {})) {
            props[key] = val
            const k = key.toLowerCase()
            const v = String(val)
            if (k === 'category' || k === 'kategoria') category = v
            else if (k === 'family' || k === 'rodzina') family = v
            else if (k === 'type' || k === 'typ') type = v
            else if (k === 'layer' || k === 'warstwa') layer = v
            else if (k === 'level' || k === 'poziom') level = v
            else if (k === 'length' || k === 'dlugosc') length = parseFloat(v) || 0
            else if (k === 'area' || k === 'powierzchnia') area = parseFloat(v) || 0
            else if (k === 'volume' || k === 'objetosc') volume = parseFloat(v) || 0
            else if (k === 'blockname' || k === 'block name') blockName = v
            else if (k === 'system') system = v
            else if (k === 'classification' || k === 'klasyfikacja') classification = v
          }
        }

        return {
          dbId: obj.objectid,
          externalId: obj.externalId,
          name: obj.name || '',
          category, family, type, layer, level,
          blockName, system, classification,
          length, area, volume,
          properties: props,
        }
      })

      return { guid: viewableGuid, elements, totalCount: elements.length }
    }
    if (res.status === 202) {
      await new Promise(r => setTimeout(r, 2000))
      attempts++
      continue
    }
    throw new Error(`Properties failed (${res.status}): ${await res.text()}`)
  }
  throw new Error('Properties extraction timed out')
}

// ── AI: Smart Classification ─────────────────────────────

async function handleAIClassify(body: any) {
  const { elements } = body
  if (!elements || !Array.isArray(elements)) throw new Error('elements array required')

  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
  if (!OPENAI_API_KEY) return { classified: elements }

  // Prepare compact representation for AI
  const compact = elements.slice(0, 100).map((e: any) => ({
    id: e.dbId,
    n: e.name,
    cat: e.category,
    fam: e.family,
    typ: e.type,
    lay: e.layer,
    blk: e.blockName,
    len: e.length,
    area: e.area,
  }))

  const prompt = `Jestes ekspertem od kosztorysow budowlanych i instalacyjnych (elektroinstalacje, teletechnika, HVAC).

Otrzymujesz elementy z modelu BIM/CAD. Dla kazdego:
1. Okresl "boqName" — czytelna polska nazwa do kosztorysu
2. Okresl "boqCategory" — jedna z: lighting, electrical_fixtures, cabling, distribution, telecom, fire_safety, hvac, plumbing, equipment, structure, architecture, other
3. Okresl "boqUnit" — szt., mb, m2, m3, kpl.
4. Okresl "confidence" — 0.0 do 1.0
5. Jesli element to smieci/pomocnicze — ustaw "skip": true

Zwroc JSON: { "results": [ { "id": ..., "boqName": "...", "boqCategory": "...", "boqUnit": "...", "confidence": 0.9, "skip": false } ] }

Elementy:
${JSON.stringify(compact, null, 1)}`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    })
    if (!res.ok) throw new Error('AI failed')
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (content) {
      const parsed = JSON.parse(content)
      return { classified: parsed.results || parsed }
    }
  } catch (err) { console.error('AI classify error:', err) }

  return { classified: [] }
}

// ── AI: Generate Full BOQ Draft ──────────────────────────

async function handleAIGenerateBOQ(body: any) {
  const { elements, projectType } = body
  if (!elements || !Array.isArray(elements)) throw new Error('elements array required')

  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
  if (!OPENAI_API_KEY) return { boq: [] }

  // Group elements first to reduce token usage
  const groups: Record<string, { name: string; count: number; layers: string[]; props: any }> = {}
  for (const e of elements) {
    const key = e.blockName || e.family || e.name || 'unknown'
    if (!groups[key]) groups[key] = { name: key, count: 0, layers: [], props: {} }
    groups[key].count++
    if (e.layer && !groups[key].layers.includes(e.layer)) groups[key].layers.push(e.layer)
    if (Object.keys(groups[key].props).length < 5) groups[key].props = e.properties || {}
  }

  const groupList = Object.values(groups).sort((a, b) => b.count - a.count).slice(0, 80)

  const prompt = `Jestes doswiadczonym kosztorysantem budowlanym. Tworzysz przedmiar robót na podstawie danych z modelu BIM/CAD.

Typ projektu: ${projectType || 'instalacja elektryczna'}

Dane z modelu (grupy elementow):
${JSON.stringify(groupList, null, 1)}

Stworz profesjonalny przedmiar. Dla kazdej pozycji podaj:
- "position" — numer pozycji
- "name" — nazwa pozycji (po polsku, profesjonalna)
- "description" — opis prac
- "category" — lighting/electrical_fixtures/cabling/distribution/telecom/fire_safety/hvac/plumbing/equipment/other
- "unit" — szt./mb/m2/m3/kpl.
- "quantity" — ilosc
- "confidence" — pewnosc 0-1
- "needsReview" — true/false
- "comment" — uwagi dla kosztorysanta

Dodaj tez pozycje ktore wynikaja z projektu ale nie sa wprost w modelu (np. przewody zasilajace, instalacja uziemiajaca, pomiary i odbiory).

Zwroc JSON: { "boq": [...], "warnings": ["..."], "missingEstimate": ["..."] }`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 4000,
      }),
    })
    if (!res.ok) throw new Error('AI BOQ generation failed')
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (content) {
      return JSON.parse(content)
    }
  } catch (err) { console.error('AI BOQ error:', err) }

  return { boq: [], warnings: ['AI generation failed — use rule-based approach'] }
}

// ── AI: Anomaly Detection ────────────────────────────────

async function handleAIAnomalies(body: any) {
  const { boqSummary } = body
  if (!boqSummary) throw new Error('boqSummary required')

  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
  if (!OPENAI_API_KEY) return { anomalies: [] }

  const prompt = `Analizujesz przedmiar instalacji elektrycznej. Sprawdz czy sa anomalie, braki, niespojnosci.

Przedmiar:
${JSON.stringify(boqSummary, null, 1)}

Sprawdz:
1. Czy sa elementy bez odpowiednich tras kablowych
2. Czy liczba wylacznikow odpowiada oprawom
3. Czy sa rozdzielnice
4. Czy sa elementy bezpieczenstwa (czujki, ROP)
5. Czy cos wygada na brakujace
6. Czy sa podejrzanie duze lub male ilosci

Zwroc JSON: { "anomalies": [{ "type": "...", "severity": "info|warning|error", "message": "..." }] }`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    })
    if (!res.ok) throw new Error('AI anomaly detection failed')
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (content) return JSON.parse(content)
  } catch (err) { console.error('AI anomaly error:', err) }

  return { anomalies: [] }
}

// ── Main Router ──────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, ...body } = await req.json()

    if (action === 'getToken') {
      const result = await handleGetToken()
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = await getToken()
    let result: any

    switch (action) {
      case 'upload': result = await handleUpload(token, body); break
      case 'translate': result = await handleTranslate(token, body); break
      case 'status': result = await handleStatus(token, body); break
      case 'delete': result = await handleDelete(token, body); break
      case 'getModelTree': result = await handleGetModelTree(token, body); break
      case 'getAllProperties': result = await handleGetAllProperties(token, body); break
      case 'aiClassify': result = await handleAIClassify(body); break
      case 'aiGenerateBOQ': result = await handleAIGenerateBOQ(body); break
      case 'aiAnomalies': result = await handleAIAnomalies(body); break
      default: throw new Error(`Unknown action: ${action}`)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('aps-proxy error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
