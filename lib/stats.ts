export function fmt(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined || !isFinite(val)) return '—'
  return val.toFixed(decimals)
}

export function fmtIp(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  const whole = Math.floor(val)
  const frac = Math.round((val - whole) * 10)
  return `${whole}.${frac}`
}

export function fipColor(val: number | null | undefined): string {
  if (val === null || val === undefined) return 'text-[#bbb]'
  if (val < 3.5) return 'text-[#2a7a2a]'
  if (val > 4.5) return 'text-[#c0392b]'
  return 'text-[#333]'
}

export function sortRows<T>(rows: T[], col: string, dir: string): T[] {
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[col]
    const bv = (b as Record<string, unknown>)[col]
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    if (typeof av === 'string') {
      return dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
    }
    return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
  })
}

// Convert baseball IP notation to true decimal for rate calculations
function ipToDecimal(ip: number): number {
  const innings = Math.floor(ip)
  const fraction = Math.round((ip - innings) * 10)
  return (innings * 3 + fraction) / 3
}

export function deriveRates(
  hits: number, bb: number, so: number, hr: number, er: number, bf: number, ip: number,
  fipConst = 3.15
) {
  const ipDec = ipToDecimal(ip)  // convert baseball notation to true decimal
  const safeDiv = (n: number, d: number) => d ? n / d : null
  return {
    era: safeDiv(er * 9, ipDec),
    whip: safeDiv(hits + bb, ipDec),
    k_pct: safeDiv(so * 100, bf),
    bb_pct: safeDiv(bb * 100, bf),
    fip: ipDec ? (13 * hr + 3 * bb - 2 * so) / ipDec + fipConst : null,
  }
}
