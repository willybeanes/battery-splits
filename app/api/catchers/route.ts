import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const season = parseInt(searchParams.get('season') ?? '2025')

  if (q.length < 2) {
    return NextResponse.json([])
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('catchers')
    .select('mlbam_id, name, team')
    .eq('season', season)
    .ilike('name', `%${q}%`)
    .order('name')
    .limit(10)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
