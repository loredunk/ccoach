#!/usr/bin/env node
// 实验探针：特性采用矩阵 + 上下文卫生 ground truth
// 只读、只输出计数/布尔/白名单标签，不存任何 prompt/内容原文。
// 用法：node docs/research/feature-adoption-probe.mjs
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(HOME, '.claude');
const CLAUDE_JSON = join(HOME, '.claude.json');

// ---------- 1. tipsHistory：值 = 该 tip 最后一次展示时的 numStartups（水位标记，非展示次数） ----------
// 已验证（CLI bundle 逆向 v2.1.170）：tips 分「无条件轮播型」与「采用条件型」两类，
// 仅条件型 tip 的水位有画像意义：近期仍展示 → 官方判定未采用；水位长期冻结 → 已采用退场。
const cj = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8'));
const tips = cj.tipsHistory || {};
const numStartups = cj.numStartups ?? 0;
// bundle 实证的条件型 tip；无条件轮播型（todo-list / theme-command 等）不具采用语义
const CONDITIONAL_TIPS = new Set([
  'prompt-queue', 'memory-command', 'git-worktrees', 'custom-agents', 'plan-mode-for-complex-tasks',
]);

// ---------- 2. 采用面：扫 JSONL 找真实使用证据（只计数，瞬时判断即弃） ----------
const evidence = {
  planMode: 0,          // permission-mode 记录切到 plan
  promptQueue: 0,       // queue-operation 记录
  subagents: 0,         // agent-name 记录 / Task 工具
  compactManual: 0,     // compact_boundary trigger=manual
  compactAuto: 0,       // compact_boundary trigger=auto
  compactPreTokens: [], // 压缩时刻的上下文规模
  turnDurations: [],    // system/turn_duration durationMs
  apiErrors: {},        // 错误 code 计数（白名单标签）
  thinkingBlocks: 0,    // assistant content 内 thinking 块计数（不读内容）
  ultrathink: 0,        // 用户 prompt 含 ultrathink 关键词（仅布尔判断即弃）
  todoTool: 0,          // TodoWrite/TaskCreate 调用
  backgroundTask: cj.hasUsedBackgroundTask === true,
  queueUseCount: cj.promptQueueUseCount ?? 0,
  btwUseCount: cj.btwUseCount ?? 0,
  sessions: 0,
};

const projectsDir = join(CLAUDE_DIR, 'projects');
for (const dir of readdirSync(projectsDir)) {
  const p = join(projectsDir, dir);
  if (!statSync(p).isDirectory()) continue;
  for (const f of readdirSync(p)) {
    if (!f.endsWith('.jsonl')) continue;
    evidence.sessions++;
    const lines = readFileSync(join(p, f), 'utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.type === 'permission-mode' && r.permissionMode === 'plan') evidence.planMode++;
      else if (r.type === 'queue-operation') evidence.promptQueue++;
      else if (r.type === 'agent-name') evidence.subagents++;
      else if (r.type === 'system') {
        if (r.subtype === 'compact_boundary') {
          const m = r.compactMetadata || {};
          if (m.trigger === 'manual') evidence.compactManual++; else evidence.compactAuto++;
          if (typeof m.preTokens === 'number') evidence.compactPreTokens.push(m.preTokens);
        } else if (r.subtype === 'turn_duration' && typeof r.durationMs === 'number') {
          evidence.turnDurations.push(r.durationMs);
        } else if (r.subtype === 'api_error') {
          const code = r.error?.connection?.code || r.error?.status || 'unknown';
          evidence.apiErrors[code] = (evidence.apiErrors[code] || 0) + 1;
        }
      } else if (r.type === 'assistant') {
        const c = r.message?.content;
        if (Array.isArray(c)) for (const b of c) {
          if (b.type === 'thinking') evidence.thinkingBlocks++;
          if (b.type === 'tool_use' && (b.name === 'TodoWrite' || b.name === 'TaskCreate')) evidence.todoTool++;
        }
      } else if (r.type === 'user') {
        const c = r.message?.content;
        const txt = typeof c === 'string' ? c : '';
        if (txt && /ultrathink/i.test(txt)) evidence.ultrathink++; // 瞬时判断，不存原文
      }
    }
  }
}

// ---------- 3. 矩阵：自有证据（主）× 条件型 tip 水位（旁证） ----------
const matrix = [
  ['plan-mode-for-complex-tasks', evidence.planMode, 'plan 模式切换次数'],
  ['prompt-queue', evidence.promptQueue + evidence.queueUseCount, 'queue-operation + 计数器'],
  ['custom-agents', evidence.subagents, 'agent-name 记录'],
  ['todo-list', evidence.todoTool, 'TodoWrite/TaskCreate 调用'],
  ['ultrathink-keyword', evidence.ultrathink, '用户提示含关键词(仅计数)'],
  ['btw-side-question', evidence.btwUseCount, 'btwUseCount 计数器'],
  ['memory-command', cj.memoryUsageCount ?? 0, 'memoryUsageCount 计数器'],
  ['background-task', evidence.backgroundTask ? 1 : 0, 'hasUsedBackgroundTask'],
];

console.log(`=== 特性采用矩阵（numStartups=${numStartups}） ===`);
console.log('feature | 使用证据 | tip水位旁证 | 判定');
for (const [name, used, src] of matrix) {
  const w = tips[name];
  let tipNote = '（轮播tip/无tip，无旁证）';
  if (CONDITIONAL_TIPS.has(name) && typeof w === 'number') {
    const staleness = numStartups - w;
    tipNote = staleness <= 30
      ? `近期仍展示(差${staleness}) → 官方判定未采用`
      : `水位冻结于#${w} → 官方判定已采用/不再适用`;
  }
  const verdict = used ? '✅ 已采用' : '⚠️ 未采用 → 推荐位';
  console.log(`${name} | ${used} | ${tipNote} | ${verdict}  (${src})`);
}

console.log('\n=== 上下文卫生 ground truth ===');
const pre = evidence.compactPreTokens;
console.log(`compact 次数: manual=${evidence.compactManual} auto=${evidence.compactAuto}`);
if (pre.length) {
  const avg = Math.round(pre.reduce((a, b) => a + b, 0) / pre.length);
  console.log(`压缩时刻上下文规模: avg=${avg} max=${Math.max(...pre)} (n=${pre.length})`);
}
const td = evidence.turnDurations.sort((a, b) => a - b);
if (td.length) {
  const p50 = td[Math.floor(td.length * 0.5)], p95 = td[Math.floor(td.length * 0.95)];
  console.log(`回合时长: n=${td.length} p50=${Math.round(p50 / 1000)}s p95=${Math.round(p95 / 1000)}s max=${Math.round(td.at(-1) / 60000)}min`);
}
console.log(`thinking 块总数: ${evidence.thinkingBlocks}（仅计数）`);
console.log(`API 错误分布:`, evidence.apiErrors);
console.log(`扫描会话数: ${evidence.sessions}`);
