/**
 * Метрики процесса (NFR-OBS-003): время ответа, ошибки, отказы авторизации, неудачные входы.
 * In-memory; в serverless — на инстанс функции (агрегирует внешний мониторинг платформы).
 */
const BUCKETS = [50, 100, 250, 500, 1000, 1500, 3000, 10000]

interface Histogram {
  count: number
  sum: number
  buckets: number[]
}

const counters = new Map<string, number>()
const histograms = new Map<string, Histogram>()

export function inc(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by)
}

export function observe(name: string, ms: number): void {
  let h = histograms.get(name)
  if (!h) histograms.set(name, (h = { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) }))
  h.count += 1
  h.sum += ms
  BUCKETS.forEach((b, i) => {
    if (ms <= b) h!.buckets[i]! += 1
  })
}

export function snapshot() {
  return {
    counters: Object.fromEntries([...counters.entries()].sort()),
    latencyMs: Object.fromEntries(
      [...histograms.entries()].sort().map(([k, h]) => [
        k,
        {
          count: h.count,
          avg: h.count ? Math.round(h.sum / h.count) : 0,
          le: Object.fromEntries(BUCKETS.map((b, i) => [String(b), h.buckets[i]])),
        },
      ]),
    ),
  }
}

export function resetMetrics(): void {
  counters.clear()
  histograms.clear()
}
