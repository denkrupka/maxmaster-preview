import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { fileBase64, fileName } = await req.json()

    if (!fileBase64 || !fileName) {
      return new Response(
        JSON.stringify({ error: 'fileBase64 and fileName are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const CLOUDCONVERT_API_KEY = Deno.env.get('CLOUDCONVERT_API_KEY')
    if (!CLOUDCONVERT_API_KEY) {
      throw new Error('Missing CLOUDCONVERT_API_KEY secret')
    }

    console.log(`Converting DWG to DXF: ${fileName}`)

    // Step 1: Create a job with upload + convert + export tasks
    const jobResponse = await fetch('https://api.cloudconvert.com/v2/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CLOUDCONVERT_API_KEY}`,
      },
      body: JSON.stringify({
        tasks: {
          'upload-file': {
            operation: 'import/base64',
            file: fileBase64,
            filename: fileName,
          },
          'convert-file': {
            operation: 'convert',
            input: ['upload-file'],
            input_format: 'dwg',
            output_format: 'dxf',
          },
          'export-file': {
            operation: 'export/url',
            input: ['convert-file'],
          },
        },
      }),
    })

    if (!jobResponse.ok) {
      const errText = await jobResponse.text()
      console.error('CloudConvert create job error:', jobResponse.status, errText)
      throw new Error(`CloudConvert error: ${jobResponse.status}`)
    }

    const job = await jobResponse.json()
    const jobId = job.data?.id

    if (!jobId) {
      throw new Error('No job ID returned from CloudConvert')
    }

    // Step 2: Wait for job completion (poll)
    let attempts = 0
    const maxAttempts = 60 // max 60 seconds
    let completedJob = null

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      attempts++

      const statusResponse = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${CLOUDCONVERT_API_KEY}`,
        },
      })

      if (!statusResponse.ok) continue

      const statusData = await statusResponse.json()
      const status = statusData.data?.status

      if (status === 'finished') {
        completedJob = statusData.data
        break
      } else if (status === 'error') {
        const errorTask = statusData.data?.tasks?.find((t: any) => t.status === 'error')
        throw new Error(`Conversion failed: ${errorTask?.message || 'Unknown error'}`)
      }
    }

    if (!completedJob) {
      throw new Error('Conversion timed out after 60 seconds')
    }

    // Step 3: Get the export URL and download the DXF
    const exportTask = completedJob.tasks?.find((t: any) => t.name === 'export-file' && t.status === 'finished')
    const fileUrl = exportTask?.result?.files?.[0]?.url

    if (!fileUrl) {
      throw new Error('No output file URL from conversion')
    }

    // Download the converted DXF
    const dxfResponse = await fetch(fileUrl)
    if (!dxfResponse.ok) {
      throw new Error('Failed to download converted DXF file')
    }

    // Convert to base64
    const dxfArrayBuffer = await dxfResponse.arrayBuffer()
    const dxfBytes = new Uint8Array(dxfArrayBuffer)
    let binary = ''
    for (let i = 0; i < dxfBytes.length; i++) {
      binary += String.fromCharCode(dxfBytes[i])
    }
    const dxfBase64 = btoa(binary)

    console.log(`Conversion complete: ${fileName} → DXF (${dxfBytes.length} bytes)`)

    return new Response(
      JSON.stringify({
        success: true,
        dxfBase64,
        fileName: fileName.replace(/\.dwg$/i, '.dxf'),
        fileSize: dxfBytes.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('dwg-convert error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
