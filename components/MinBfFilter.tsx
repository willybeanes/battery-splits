'use client'

const OPTIONS = [1, 10, 25, 50, 100, 150, 200]

interface Props {
  value: number
  onChange: (n: number) => void
}

export function MinBfFilter({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-[#888] uppercase tracking-widest">Min BF</span>
      <select
        value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        className="bg-white border border-[#d0cbc3] rounded-lg px-3 py-1.5 text-sm text-[#1a1a1a] outline-none cursor-pointer"
      >
        {OPTIONS.map(n => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </div>
  )
}
