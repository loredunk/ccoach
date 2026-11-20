// Classify only human input. Keep counts and phase flags, never message text.
const DESIGN = [
  /\b(?:discuss|compare|evaluate|clarify|review|explore|think through|talk through)\b[^.!?\n]{0,80}\b(?:design|requirements?|approach|options?|trade-?offs?|scope|architecture|edge cases?|plan)\b/i,
  /\b(?:how should we|what are the trade-?offs|(?:propose|draft|outline|make) (?:a |the )?(?:plan|design)|ask me (?:clarifying )?questions)\b/i,
  /(?:讨论|明确|澄清|梳理|评审|比较|对比)[^。！？\n]{0,24}(?:设计|需求|方案|取舍|范围|架构|边界)|先(?:想清楚|定方案|做设计|问我)|给出.{0,12}(?:方案|计划)/,
]
const DEFER_EDIT = /\b(?:before (?:we )?(?:implement|code|edit)\b|plan only\b|then (?:we can |we'll )?(?:implement|code)\b|(?:do not|don't|don’t) (?:implement|edit|write code) (?:yet|for now)\b)|先别(?:写代码|改代码|实现|动手)|暂不(?:实现|改代码)|(?:再|之后才)(?:实现|写代码|动手)/i
const IMPLEMENT = /(?:^|[.!?;\n]\s*)\s*(?:(?:please|now|let's)\s+)*(?:implement|build|add|fix|change|remove|refactor|update|apply)\b|\b(?:go ahead|start implementing|can you (?:implement|build|add|fix|change|update)|please (?:implement|build|add|fix|change|update))\b|(?:请|直接|现在|开始|继续|可以|应该|我希望|我想|帮我|去|来)(?:给.{0,12})?(?:实现|开发|加(?:入|上|一个)?|做|修复|修改|更新|重构)|(?:^|[。！？；\n])\s*(?:实现|新增|加上|增加|修复|改成|修改|重构)/i
const CRITERIA = [
  /\b(?:acceptance criteria|expected (?:behaviou?r|result|output)|success criteria|non-goals?)\s*:\s*\S|\b(?:should (?:return|show|reject|preserve|allow|remain|keep|handle|display)|must (?:not |never )?\w+|out of scope|backwards? compatib\w*)\b/i,
  /\b(?:(?:when|if) [^.!?\n]{1,80}(?:should|must|return|show|reject)|(?:keep|preserve) (?:the |existing )[^.!?\n]{0,50}(?:unchanged|compatib\w*|behaviou?r|format))\b/i,
  /(?:验收(?:标准|条件)|预期(?:行为|结果|输出)|边界(?:条件|情况|用例))\s*[:：]\s*\S|向后兼容|不在范围|(?:必须|不得|禁止)\S|不能(?:修改|删除|改变|覆盖)|应(?:该)?(?:返回|显示|保留|拒绝|允许|保持|支持)/,
  /(?:如果|当|遇到)[^。！？\n]{1,45}(?:就|则|时|应)[^。！？\n]{0,20}(?:返回|显示|保留|拒绝|处理|跳过|报错|退出)/,
]
const SYMPTOM = /\b(?:doesn['’]t (?:work|load|show)|is(?:n['’]t| not) (?:working|loading|showing)|crashes?|regression|broken|blank screen|HTTP [45]\d\d)\b|报错|崩溃|闪退|白屏|黑屏|卡住|没反应|失败了|不对劲|(?:未|没)有?(?:显示|加载|生效)/i

export interface ConversationHabits {
  observed_prompts: number
  design_prompts_before_implementation: number
  criteria_prompts_before_implementation: number
  implementation_starts: number
  starts_after_design: number
  starts_without_design_or_criteria: number
  prompts_after_edits: number
  criteria_prompts_after_edits: number
  symptom_prompts_without_criteria_after_edits: number
}

function emptyHabits(): ConversationHabits {
  return {
    observed_prompts: 0,
    design_prompts_before_implementation: 0,
    criteria_prompts_before_implementation: 0,
    implementation_starts: 0,
    starts_after_design: 0,
    starts_without_design_or_criteria: 0,
    prompts_after_edits: 0,
    criteria_prompts_after_edits: 0,
    symptom_prompts_without_criteria_after_edits: 0,
  }
}

export class ConversationPhase {
  edited = false
  started = false
  discussedDesign = false
  statedCriteria = false
}

export class ConversationHabitsAccumulator {
  readonly total = emptyHabits()
  readonly projects = new Map<string, ConversationHabits>()

  constructor(private readonly byProject: boolean) {}

  prompt(phase: ConversationPhase, text: string, repo: string, inWindow: boolean): void {
    const prose = text.replace(/```[\s\S]*?(?:```|$)/g, '')
    const design = DESIGN.some((pattern) => pattern.test(prose))
    const criteria = CRITERIA.some((pattern) => pattern.test(prose))
    const implementsNow = IMPLEMENT.test(prose) && !(design && DEFER_EDIT.test(prose))
    const early = !phase.started && !phase.edited
    const starts = early && implementsNow

    if (inWindow) {
      const buckets = [this.total]
      if (this.byProject && repo && repo !== '(unknown)') {
        let project = this.projects.get(repo)
        if (!project) {
          project = emptyHabits()
          this.projects.set(repo, project)
        }
        buckets.push(project)
      }
      for (const counts of buckets) {
        counts.observed_prompts++
        if (early && !implementsNow && design) counts.design_prompts_before_implementation++
        if (early && criteria) counts.criteria_prompts_before_implementation++
        if (starts) {
          counts.implementation_starts++
          if (phase.discussedDesign) counts.starts_after_design++
          if (!phase.discussedDesign && !phase.statedCriteria && !criteria) counts.starts_without_design_or_criteria++
        }
        if (phase.edited) {
          counts.prompts_after_edits++
          if (criteria) counts.criteria_prompts_after_edits++
          else if (SYMPTOM.test(prose)) counts.symptom_prompts_without_criteria_after_edits++
        }
      }
    }

    if (early) {
      phase.started = implementsNow
      phase.discussedDesign ||= !implementsNow && design
      phase.statedCriteria ||= criteria
    }
  }
}
