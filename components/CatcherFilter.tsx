'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Catcher, FilterMode, Season } from '@/lib/types'

interface Props {
  season: Season
  selectedCatcher: Catcher | null
  mode: FilterMode
  onCatcherChange: (c: Catcher | null) => void
  onModeChange: (m: FilterMode) => void
}

export function CatcherFilter({ season, selectedCatcher, mode, onCatcherChange, onModeChange }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Catcher[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchCatchers = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/catchers?q=${encodeURIComponent(q)}&season=${season}`)
      const data = await res.json()
      setResults(data)
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }, [season])

  useEffect(() => {
    const t = setTimeout(() => fetchCatchers(query), 200)
    return () => clearTimeout(t)
  }, [query, fetchCatchers])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selectCatcher(c: Catcher) {
    onCatcherChange(c)
    if (mode === 'all') onModeChange('was')
    setQuery('')
    setOpen(false)
  }

  function clear() {
    onCatcherChange(null)
    onModeChange('all')
    setQuery('')
    setResults([])
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-semibold text-[#888] uppercase tracking-widest">Catcher</span>

      {/* WAS / WASN'T toggle — only active when a catcher is selected */}
      {selectedCatcher && (
        <div className="flex rounded-lg overflow-hidden border border-[#d0cbc3]">
          {(['was', 'wasnt'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                mode === m
                  ? 'bg-[#1a1a1a] text-white'
                  : 'bg-white text-[#666] hover:text-[#1a1a1a]'
              }`}
            >
              {m === 'was' ? 'WAS' : "WAS'NT"}
            </button>
          ))}
        </div>
      )}

      {/* Catcher search input */}
      <div className="relative">
        <div className="flex items-center gap-2 bg-white border border-[#d0cbc3] rounded-lg px-3 py-1.5 min-w-[220px]">
          {selectedCatcher ? (
            <span className="text-sm text-[#1a1a1a] font-medium flex-1">{selectedCatcher.name}</span>
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => results.length > 0 && setOpen(true)}
              placeholder="Search catcher…"
              className="bg-transparent text-sm text-[#1a1a1a] placeholder-[#aaa] outline-none flex-1 w-full"
            />
          )}
          <svg className="w-4 h-4 text-[#aaa] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
        </div>

        {/* Dropdown */}
        {open && results.length > 0 && !selectedCatcher && (
          <div
            ref={dropdownRef}
            className="absolute top-full mt-1 left-0 w-full bg-white border border-[#d0cbc3] rounded-lg shadow-lg z-50 overflow-hidden"
          >
            {loading && (
              <div className="px-3 py-2 text-xs text-[#999]">Loading…</div>
            )}
            {results.map((c) => (
              <button
                key={c.mlbam_id}
                onMouseDown={() => selectCatcher(c)}
                className="w-full text-left px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#f5f2ed] flex items-center justify-between gap-2 transition-colors"
              >
                <span className="font-medium">{c.name}</span>
                {c.team && <span className="text-xs text-[#999]">{c.team}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Clear */}
      {selectedCatcher && (
        <button
          onClick={clear}
          className="text-sm text-[#999] hover:text-[#1a1a1a] flex items-center gap-1 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Clear
        </button>
      )}
    </div>
  )
}
