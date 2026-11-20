import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runReport } from '../src/run-report.js'
import { Aggregator } from '../src/aggregate.js'

it('counts all project episodes before truncating episode details', () => {
  const agg = new Aggregator('all', 'project')
  const ts = new Date('2026-08-10T12:00:00Z')
  for (let i = 0; i < 205; i++) {
    agg.beginEpisode('alpha-log', 'alpha', ts, false)
    if (i < 3) {
      for (let j = 0; j < 8; j++) agg.applyTool('file', undefined, { isEdit: true, fileKey: 'same.ts' })
    } else {
      agg.applyTool('file')
    }
  }
  agg.beginEpisode('beta-log', 'beta', ts, false)
  agg.applyTool('file')
  agg.beginRecord('gamma', 'gamma-log', ts)
  const report = agg.assemble({ fromYmd: '2026-08-10', toYmd: '2026-08-10', desc: 'test' }, 'glob')
  expect(report.projects).toMatchObject([
    { repo: 'alpha', episodes: 205, spiral_episodes: 3, spiral_rate: 3 / 205 },
    { repo: 'beta', episodes: 1, spiral_episodes: 0, spiral_rate: 0 },
    { repo: 'gamma', episodes: 0, spiral_episodes: 0, spiral_rate: null },
  ])
  expect(report.episode_summary).toMatchObject({ episodes: 206, spiral_episodes: 3 })
})

it('reports chronological local habits from both platforms without including raw text', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccoach-conversation-'))
  const claudeDir = join(root, 'claude')
  const codexHome = join(root, 'codex')
  const codexSessions = join(codexHome, 'sessions')
  const previous = '2026-08-08T12:00:00Z'
  const today = '2026-08-10T12:00:00Z'
  const cwd = join(root, 'alpha')
  const user = (content: unknown, fields = {}) => ({
    type: 'user', sessionId: 'claude-main', cwd, timestamp: today, message: { content }, ...fields,
  })
  const legacyPrompt = (message: string, timestamp = today) =>
    ({ type: 'event_msg', timestamp, payload: { type: 'user_message', message } })
  const completed = (item: object, timestamp = today) =>
    ({ type: 'event_msg', timestamp, payload: { type: 'item_completed', item } })
  const modernPrompt = (text: string, timestamp = today) =>
    completed({ type: 'UserMessage', content: [{ type: 'text', text }] }, timestamp)
  const meta = (id: string, source: unknown = 'cli') =>
    ({ type: 'session_meta', timestamp: previous, payload: { id, cwd: join(root, 'beta'), source } })
  const log = (path: string, rows: object[]) => writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n'))
  const opts = { since: '2026-08-10', now: new Date(today), scope: 'project', claudeDir, codexHome }
  const privateText = 'PRIVATE_TEXT_9270'

  try {
    mkdirSync(claudeDir)
    mkdirSync(codexSessions, { recursive: true })
    log(join(claudeDir, 'main.jsonl'), [
      user('先讨论需求。空输入必须返回空列表。', { timestamp: previous }),
      user('先讨论边界，再实现。', { uuid: 'design' }),
      user('请实现。'),
      {
        type: 'assistant', sessionId: 'claude-main', cwd, timestamp: today,
        message: { content: [{ type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: 'alpha.ts' } }] },
      },
      user([{ type: 'tool_result', tool_use_id: 'edit-1', is_error: true }]),
      user('白屏了。'),
      user([{ type: 'tool_result', tool_use_id: 'edit-1' }]),
      user(`白屏了。${privateText}`),
      user('空输入应该返回空列表。'),
      user('必须删除这一行。', { isMeta: true }),
      user('执行子代理任务。', { isSidechain: true }),
    ])
    log(join(claudeDir, 'z-fork.jsonl'), [user('先讨论边界，再实现。', { uuid: 'design' })])
    log(join(codexSessions, 'rollout-legacy.jsonl'), [
      meta('codex-legacy'),
      legacyPrompt('Fix the login flow.'),
      { type: 'event_msg', timestamp: today, payload: { type: 'patch_apply_end', success: true, changes: { 'login.ts': {} } } },
      legacyPrompt('It crashes with an expired token.'),
      legacyPrompt('Expected behavior: it should return 401.'),
      { type: 'response_item', timestamp: today, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'It crashes.' }] } },
    ])
    log(join(codexSessions, 'rollout-modern.jsonl'), [
      meta('codex-modern'),
      modernPrompt('Compare approaches and discuss requirements.', previous),
      modernPrompt('Implement it. An expired token must return 401.'),
      completed({ type: 'FileChange', status: 'completed', changes: { 'login.ts': {} } }),
      modernPrompt('It crashes. It should show a retry button.'),
    ])
    log(join(codexSessions, 'rollout-subagent.jsonl'), [
      meta('codex-subagent', { subagent: { thread_spawn: {} } }),
      modernPrompt('Implement it.'),
    ])

    const raw = runReport({ ...opts, json: true, conversationHabits: true, glossary: false })
    expect(raw).not.toContain(privateText)
    const report = JSON.parse(raw)
    expect(report.conversation_habits).toEqual({
      observed_prompts: 10,
      design_prompts_before_implementation: 1,
      criteria_prompts_before_implementation: 1,
      implementation_starts: 3,
      starts_after_design: 2,
      starts_without_design_or_criteria: 1,
      prompts_after_edits: 5,
      criteria_prompts_after_edits: 3,
      symptom_prompts_without_criteria_after_edits: 2,
    })
    expect(report.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ repo: 'alpha', conversation_habits: expect.objectContaining({
        observed_prompts: 5, starts_after_design: 1, prompts_after_edits: 2,
      }) }),
      expect.objectContaining({ repo: 'beta', conversation_habits: expect.objectContaining({
        observed_prompts: 5, starts_after_design: 1, starts_without_design_or_criteria: 1, prompts_after_edits: 3,
      }) }),
    ]))
    const normal = JSON.parse(runReport({ ...opts, json: true, glossary: false }))
    expect(normal.conversation_habits).toBeUndefined()
    expect(normal.episode_summary).toEqual(report.episode_summary)
    const text = runReport({ ...opts, conversationHabits: true, lang: 'zh' })
    expect(text).toContain('项目打转率')
    expect(text).toContain('观察到 10 条输入')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
