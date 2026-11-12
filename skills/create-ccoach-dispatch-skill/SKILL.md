---
name: create-ccoach-dispatch-skill
description: Generate or update a project-specific ccoach dispatch skill for Dot or another agent orchestrator. Use when someone wants to customize how workers receive shared project context and verify prompt-cache savings with local usage data.
---

# Create a ccoach dispatch skill

Generate a project skill that an orchestrator can use when the user asks it to dispatch multiple tasks. Use the project's existing skill location or the target host's documented location. If the host has no verified skill location, write the skill in the project's `skills/` directory as a draft and record what installation detail is missing. Use `ccoach-dispatch` as the default name and update an existing skill in place when appropriate.

## Inspect the project and host

- Read the repository instructions, test entry points, existing dispatch workflows, and any previous ccoach measurements. Select a compact shared context with stable project instructions and verification commands that the workers will actually need. Record how to source it consistently.
- Check the host's available tools or official docs for starting and resuming workers, choosing models, observing the first response, and getting worker session IDs. Check which parts of the actual request the host allows the dispatcher to control. Ask about preferences such as acceptable delay or concurrency only when they affect the generated defaults and cannot be inferred from the project.
- Check the installed ccoach version and its CLI help. Verify whether the target worker's logs are visible and can be joined to its session ID. Identify a request-level source for first-request input and cache-read tokens. A session total cannot establish the first-request count. If ccoach only exposes session totals, record the missing coverage and any verified request-level alternative.

## Generate the dispatch workflow

Write a `SKILL.md` with the discovered commands and evidence sources. Include the following decisions, adapted to what the host supports.

1. Identify the worker's actual provider, model and API or host interface. Consult current official documentation for cacheable length, prefix boundaries, when a cache write becomes readable, retention, and applicable prices. Refresh the rules when the model or interface changes. Mark any host behavior that the provider docs alone cannot establish.
2. Keep each task's dependencies, write scope and acceptance criteria intact. Consider resuming the original worker for dependent follow-up work. For independent tasks, keep shared instructions and tool definitions stable where the host allows it, and put task-specific instructions after the common context. Use provider-supported cache controls only when exposed by the host. Compare immediate parallel dispatch with a staggered start when the common prefix is likely to be eligible and the delay is acceptable.
3. Record the strategy, model, worker session ID and dispatch time for each task. Read first-request cache tokens separately from whole-task usage. Compare estimated cost per completed task with comparable pre-skill ccoach history or a controlled baseline. Include cache reads, cache writes, uncached input, output and retries where observable. Report missing fields as unknown and keep unlike tasks out of direct comparisons.

## Prove the generated skill on the real host

When the user has requested a live verification, use two distinct, read-only tasks that share the same project context and worker configuration. For a staggered trial, send A first and dispatch B once the provider's cache-readiness condition is met. If first output is the observable readiness signal, dispatch B when A starts responding. Record timestamps, model and worker IDs, then retrieve B's first-request cache-read and total input tokens. Report the measured ratio with its denominator. A hit proves that some input was reused. Attribute it to the project prefix only if request-level diagnostics or a suitable control support that conclusion.

Record the exact blocker when dispatch, timing or request-level measurement cannot be verified. Mark the generated skill as a draft until the real host path has been exercised. Enable staggered dispatch as a project default only when observed results support the cost and latency tradeoff.
