'use client'

import { SortCol, SortDir } from '@/lib/types'

interface Props {
  col: SortCol
  label: string
  sortCol: SortCol
  sortDir: SortDir
  onSort: (col: SortCol) => void
  align?: 'left' | 'right'
  title?: string
}

export function StatHeader({ col, label, sortCol, sortDir, onSort, align = 'right', title }: Props) {
  const active = sortCol === col
  return (
    <th
      title={title}
      onClick={() => onSort(col)}
      className={`px-3 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors
        ${active ? 'text-[#1a1a1a]' : 'text-[#999] hover:text-[#1a1a1a]'}
        ${align === 'right' ? 'text-right' : 'text-left'}
      `}
    >
      {label}
      {active && (
        <span className="ml-1 inline-block">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  )
}
