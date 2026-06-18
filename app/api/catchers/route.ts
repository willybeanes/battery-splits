import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

function deaccent(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const season = parseInt(searchParams.get('season') ?? '2025')

  if (q.length < 2) return NextResponse.json([])

  const db = createServiceClient()
  const { data, error } = await db
    .from('catchers')
    .select('mlbam_id, name, team')
    .eq('season', season)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const needle = deaccent(q)
  const results = (data ?? [])
    .filter(r => deaccent(r.name ?? '').includes(needle))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .slice(0, 10)

  return NextResponse.json(results)
}
