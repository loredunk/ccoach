// Single source of truth for the ADR-0043 human-prompt gate.
// Claude Code records several NON-human-instruction strings as `type:"user"`:
// isMeta system reminders / caveats / command-output injection, slash command stubs
// (<command-name> …), and the interrupt sentinel [Request interrupted by user].
// These are NOT real prompts / episode boundaries. Every code path that counts a
// "user prompt" (main parser + the `ccoach sessions` drilldown) MUST gate on this,
// or the two paths disagree (the bug ADR 0043 fixed in the parser but missed in sessions).
//
// Privacy: `text` is used transiently for boolean matching only — never stored/emitted
// (守 ADR 0015/0016 红线). These are Claude-internal structural tags/sentinels that
// legitimate user prose would never contain, so matching them as noise is an accepted,
// negligible-risk trade-off. Codex rollouts have no such machine-injected user records;
// applying the same predicate there is harmless defensive symmetry (ADR 0011/0043).

export const COMMAND_STUB_RE = /<\/?(command-name|command-message|command-args|local-command-stdout|local-command-stderr)>/i
export const INTERRUPT_RE = /\[Request interrupted by user/i

export function isHumanPrompt(rec: any, text: string): boolean {
  if (rec?.isMeta === true) return false // 系统提醒 / caveat / 命令输出注入（最大噪声源）
  if (COMMAND_STUB_RE.test(text)) return false // slash 命令桩
  if (INTERRUPT_RE.test(text)) return false // 中断哨兵（interrupted 信号另由 toolUseResult.interrupted 派生，互不影响）
  return text.trim().length > 0
}
