import { tf } from './i18n.js'

export interface WindowOpts { date?: string; since?: string; days?: number }
export interface Window { fromYmd: string; toYmd: string; desc: string }

const YMD = /^\d{4}-\d{2}-\d{2}$/
export function localYmd(d: Date): string {
  // 'en-CA' 产出 YYYY-MM-DD；不传 timeZone 即用本机时区。
  return new Intl.DateTimeFormat('en-CA').format(d)
}
function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, day] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day + delta))
  return dt.toISOString().slice(0, 10)
}
export function resolveWindow(o: WindowOpts, now: Date): Window {
  const today = localYmd(now)
  if (o.date) {
    if (!YMD.test(o.date)) throw new Error(`invalid --date ${o.date} (want YYYY-MM-DD)`)
    return { fromYmd: o.date, toYmd: o.date, desc: o.date }
  }
  if (o.since) {
    if (!YMD.test(o.since)) throw new Error(`invalid --since ${o.since} (want YYYY-MM-DD)`)
    return { fromYmd: o.since, toYmd: today, desc: tf('win_since_to', { since: o.since, today }) }
  }
  if (o.days && o.days > 0) {
    const from = addDaysYmd(today, -(o.days - 1))
    return { fromYmd: from, toYmd: today, desc: tf('win_last_days', { days: o.days, from, today }) }
  }
  return { fromYmd: today, toYmd: today, desc: today }
}
export function inLocalRange(ts: Date, w: Window): boolean {
  const ymd = localYmd(ts)
  return ymd >= w.fromYmd && ymd <= w.toYmd
}
