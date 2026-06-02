// 文件扩展名 -> 语言标签（移植 collect_claude_behavior.py:EXT_LANG / language.go 口径）。
// 仅用于按"已变更/读写文件的扩展名"推断仓库主导语言，是 language.go 全量文件扫描的最小版。
export const EXT_LANG: Record<string, string> = {
  py: 'Python', go: 'Go', js: 'JavaScript', jsx: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', rs: 'Rust', java: 'Java',
  kt: 'Kotlin', swift: 'Swift', c: 'C', h: 'C/C++ Header',
  cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++ Header',
  rb: 'Ruby', php: 'PHP', cs: 'C#', sh: 'Shell', bash: 'Shell',
  zsh: 'Shell', fish: 'Shell', html: 'HTML', htm: 'HTML',
  css: 'CSS', scss: 'CSS', less: 'CSS', md: 'Markdown',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  xml: 'XML', sql: 'SQL', vue: 'Vue', svelte: 'Svelte',
  dart: 'Dart', scala: 'Scala', lua: 'Lua', r: 'R',
  ipynb: 'Jupyter', txt: 'Text', cfg: 'Config', ini: 'Config',
  env: 'Config', gradle: 'Gradle', proto: 'Protobuf',
}

// 选"仓库主导语言"时跳过的非编程标签（文档 / 配置 / 数据），避免一个 README 把仓库标成 Markdown。
const AUX_LABELS = new Set(['Markdown', 'Config', 'Text', 'JSON', 'YAML', 'TOML', 'XML'])

export function extToLanguage(ext: string): string | undefined {
  if (typeof ext !== 'string' || !ext) return undefined
  return EXT_LANG[ext.toLowerCase()]
}

// 由扩展名计数推断主导编程语言：取计数最高、且标签为真正编程语言的扩展名；
// 计数相同按扩展名升序确定（确定性）。仅文档/配置/数据时返回 undefined。
export function dominantLanguage(fileTypes: Map<string, number> | Record<string, number>): string | undefined {
  const entries = fileTypes instanceof Map ? [...fileTypes.entries()] : Object.entries(fileTypes)
  let best: { lang: string; count: number; ext: string } | undefined
  for (const [extRaw, count] of entries) {
    const ext = extRaw.toLowerCase()
    const lang = EXT_LANG[ext]
    if (!lang || AUX_LABELS.has(lang)) continue
    if (!best || count > best.count || (count === best.count && ext < best.ext)) {
      best = { lang, count, ext }
    }
  }
  return best?.lang
}
