import { type Report } from '../model.js'

export function emitJson(report: Report): string {
  return JSON.stringify(report, null, 2)
}
