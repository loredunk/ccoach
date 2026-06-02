package codexreport

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// writeRollout writes JSONL lines to a temp rollout file and returns its path.
func writeRollout(t *testing.T, lines ...string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "rollout-test.jsonl")
	content := ""
	for _, l := range lines {
		content += l + "\n"
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func dayOpts(t *testing.T, date string) parseOptions {
	loc := time.UTC
	d, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		t.Fatal(err)
	}
	return parseOptions{from: d, to: d.AddDate(0, 0, 1), loc: loc}
}

func TestTokenDeltaDedupAndNullInfo(t *testing.T) {
	// Cumulative-only token_count samples (no last_token_usage), so we diff the
	// total against the previous total starting at zero. The first sample is now
	// counted (ccusage's method), not discarded as a baseline. The middle line is
	// an info==null rate-limit refresh that must NOT add an increment, and the
	// final line repeats the same cumulative value (over-report trap) and must
	// add zero. The session total therefore equals the final cumulative total.
	path := writeRollout(t,
		`{"timestamp":"2026-05-13T01:00:00Z","type":"turn_context","payload":{"model":"gpt-5.4"}}`,
		`{"timestamp":"2026-05-13T01:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10,"reasoning_output_tokens":4,"total_tokens":110}}}}`,
		`{"timestamp":"2026-05-13T01:00:02Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"primary":{"used_percent":5}}}}`,
		`{"timestamp":"2026-05-13T01:00:03Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":300,"cached_input_tokens":140,"output_tokens":30,"reasoning_output_tokens":12,"total_tokens":330}}}}`,
		`{"timestamp":"2026-05-13T01:00:04Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":300,"cached_input_tokens":140,"output_tokens":30,"reasoning_output_tokens":12,"total_tokens":330}}}}`,
	)

	agg := newAggregate()
	parseThread(Thread{ID: "t1", RolloutPath: path, Model: "gpt-5.4"}, dayOpts(t, "2026-05-13"), agg)

	if agg.tokens.Input != 300 || agg.tokens.CachedInput != 140 || agg.tokens.Output != 30 {
		t.Fatalf("unexpected token totals: %+v", agg.tokens)
	}
	if agg.tokens.Total != 330 {
		t.Fatalf("unexpected total: %d", agg.tokens.Total)
	}
}

func TestLastTokenUsagePreferred(t *testing.T) {
	// When Codex records per-turn last_token_usage, we sum those directly rather
	// than diffing the cumulative total — including for a single-turn session,
	// which the old baseline-diff approach incorrectly counted as zero.
	path := writeRollout(t,
		`{"timestamp":"2026-05-13T01:00:00Z","type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"timestamp":"2026-05-13T01:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10,"reasoning_output_tokens":4,"total_tokens":110},"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10,"reasoning_output_tokens":4,"total_tokens":110}}}}`,
		`{"timestamp":"2026-05-13T01:00:02Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":200,"cached_input_tokens":100,"output_tokens":20,"reasoning_output_tokens":8,"total_tokens":220},"total_token_usage":{"input_tokens":300,"cached_input_tokens":140,"output_tokens":30,"reasoning_output_tokens":12,"total_tokens":330}}}}`,
	)

	agg := newAggregate()
	parseThread(Thread{ID: "t1", RolloutPath: path, Model: "gpt-5"}, dayOpts(t, "2026-05-13"), agg)

	// Sum of last_token_usage = 300/140/30/330, matching the final cumulative.
	if agg.tokens.Input != 300 || agg.tokens.CachedInput != 140 || agg.tokens.Output != 30 || agg.tokens.Total != 330 {
		t.Fatalf("unexpected token totals: %+v", agg.tokens)
	}
}

func TestSingleTurnSessionCounted(t *testing.T) {
	// A one-event (cumulative-only) session must be counted, not zeroed.
	path := writeRollout(t,
		`{"timestamp":"2026-05-13T01:00:00Z","type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"timestamp":"2026-05-13T01:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10,"reasoning_output_tokens":4,"total_tokens":110}}}}`,
	)

	agg := newAggregate()
	parseThread(Thread{ID: "t1", RolloutPath: path, Model: "gpt-5"}, dayOpts(t, "2026-05-13"), agg)

	if agg.tokens.Total != 110 || agg.tokens.Input != 100 {
		t.Fatalf("single-turn session should be counted, got %+v", agg.tokens)
	}
}

func TestToolCountingAndCommands(t *testing.T) {
	path := writeRollout(t,
		`{"timestamp":"2026-05-13T02:00:00Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"rg -n foo\"}"}}`,
		`{"timestamp":"2026-05-13T02:00:01Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"bash -lc \\\"rg bar\\\"\"}"}}`,
		`{"timestamp":"2026-05-13T02:00:02Z","type":"response_item","payload":{"type":"web_search_call"}}`,
		`{"timestamp":"2026-05-13T02:00:03Z","type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch"}}`,
		`{"timestamp":"2026-05-13T02:00:04Z","type":"event_msg","payload":{"type":"patch_apply_end","changes":{"/a.go":{},"/b.go":{}}}}`,
	)
	agg := newAggregate()
	parseThread(Thread{ID: "t2", RolloutPath: path}, dayOpts(t, "2026-05-13"), agg)

	if agg.shellCalls != 2 {
		t.Fatalf("shell=%d want 2", agg.shellCalls)
	}
	if agg.webSearches != 1 {
		t.Fatalf("web=%d want 1", agg.webSearches)
	}
	if agg.fileChanges != 2 {
		t.Fatalf("fileChanges=%d want 2", agg.fileChanges)
	}
	if agg.totalCalls != 4 { // 2 exec + 1 web + 1 custom_tool
		t.Fatalf("totalCalls=%d want 4", agg.totalCalls)
	}
	if agg.shellCommands["rg"] != 2 {
		t.Fatalf("rg count=%d want 2 (bash wrapper should be stripped)", agg.shellCommands["rg"])
	}
}

func TestOutOfWindowExcluded(t *testing.T) {
	path := writeRollout(t,
		`{"timestamp":"2026-05-12T23:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":10,"reasoning_output_tokens":0,"total_tokens":110}}}}`,
		`{"timestamp":"2026-05-14T00:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":500,"cached_input_tokens":0,"output_tokens":50,"reasoning_output_tokens":0,"total_tokens":550}}}}`,
	)
	agg := newAggregate()
	parseThread(Thread{ID: "t3", RolloutPath: path}, dayOpts(t, "2026-05-13"), agg)
	if agg.tokens.Total != 0 {
		t.Fatalf("expected nothing in-window, got %+v", agg.tokens)
	}
}

func TestDuplicateRolloutPathIsCountedOnce(t *testing.T) {
	path := writeRollout(t,
		`{"timestamp":"2026-05-13T01:00:00Z","type":"session_meta","payload":{"id":"same-session","cwd":"/tmp/repo"}}`,
		`{"timestamp":"2026-05-13T01:00:01Z","type":"turn_context","payload":{"model":"gpt-5.4-mini"}}`,
		`{"timestamp":"2026-05-13T01:00:02Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":10,"reasoning_output_tokens":0,"total_tokens":110}}}}`,
		`{"timestamp":"2026-05-13T01:00:03Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":300,"cached_input_tokens":0,"output_tokens":30,"reasoning_output_tokens":0,"total_tokens":330}}}}`,
	)

	threads := dedupeThreads([]Thread{
		{ID: "same-session", RolloutPath: path, Source: "vscode"},
		{ID: "same-session", RolloutPath: path, Source: "codex-app"},
	})

	agg := newAggregate()
	for _, thread := range threads {
		parseThread(thread, dayOpts(t, "2026-05-13"), agg)
	}

	if agg.tokens.Total != 330 {
		t.Fatalf("duplicate rollout should count once, got %+v", agg.tokens)
	}
}

func TestUsageBreakdownsTrackSourceAndLanguage(t *testing.T) {
	repo := t.TempDir()
	if err := os.Mkdir(filepath.Join(repo, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "go.mod"), []byte("module example\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	path := writeRollout(t,
		`{"timestamp":"2026-05-13T01:00:00Z","type":"turn_context","payload":{"model":"gpt-5.4-mini"}}`,
		`{"timestamp":"2026-05-13T01:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":10,"reasoning_output_tokens":0,"total_tokens":110}}}}`,
		`{"timestamp":"2026-05-13T01:00:02Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"go test ./...\"}"}}`,
		`{"timestamp":"2026-05-13T01:00:03Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"git status --short\"}"}}`,
		`{"timestamp":"2026-05-13T01:00:04Z","type":"event_msg","payload":{"type":"patch_apply_end","changes":{"main.go":{},"README.md":{}}}}`,
		`{"timestamp":"2026-05-13T01:00:04Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":300,"cached_input_tokens":0,"output_tokens":30,"reasoning_output_tokens":0,"total_tokens":330}}}}`,
	)

	agg := newAggregate()
	parseThread(Thread{ID: "go-cli", RolloutPath: path, Cwd: repo, Source: "cli"}, dayOpts(t, "2026-05-13"), agg)

	if got := agg.bySource["cli"].tokens.Total; got != 330 {
		t.Fatalf("source tokens=%d want 330", got)
	}
	if got := agg.byLanguage["Go"].tokens.Total; got != 330 {
		t.Fatalf("language tokens=%d want 330", got)
	}
	ra := agg.byRepo[filepath.Base(repo)]
	if ra == nil {
		t.Fatal("missing repo aggregate")
	}
	if ra.language != "Go" {
		t.Fatalf("repo language=%q want Go", ra.language)
	}
	if !ra.buildSystems["Go modules"] {
		t.Fatalf("expected Go modules build system, got %#v", ra.buildSystems)
	}
	if !ra.testCommands["go test ./..."] {
		t.Fatalf("expected test command, got %#v", ra.testCommands)
	}
	if ra.fileTypes["Go"] != 1 || ra.fileTypes["Markdown"] != 1 {
		t.Fatalf("unexpected file types: %#v", ra.fileTypes)
	}
	if agg.gitCommands["status"] != 1 {
		t.Fatalf("expected git status command, got %#v", agg.gitCommands)
	}
}

func TestEstimateCost(t *testing.T) {
	d := tokenUsage{Input: 1_000_000, CachedInput: 500_000, Output: 1_000_000}
	cost, ok := estimateCost(d, "gpt-5.4")
	if !ok {
		t.Fatal("expected gpt-5.4 to be priced")
	}
	// 0.5M*2.50 + 0.5M*0.25 + 1M*15 = 1.25 + 0.125 + 15 = 16.375
	if cost < 16.37 || cost > 16.38 {
		t.Fatalf("cost=%f want ~16.375", cost)
	}

	cost, ok = estimateCost(d, "gpt-5.4-mini")
	if !ok {
		t.Fatal("expected gpt-5.4-mini to be priced")
	}
	// More specific prefixes must win over the gpt-5.4 family default.
	if cost < 4.91 || cost > 4.92 {
		t.Fatalf("cost=%f want ~4.9125", cost)
	}

	cost, ok = estimateCost(d, "gpt-5.4-nano")
	if !ok {
		t.Fatal("expected gpt-5.4-nano to be priced")
	}
	if cost < 1.35 || cost > 1.37 {
		t.Fatalf("cost=%f want ~1.36", cost)
	}
	// codex-mini variants must use mini pricing, not the family default.
	cost, ok = estimateCost(d, "gpt-5.1-codex-mini")
	if !ok {
		t.Fatal("expected gpt-5.1-codex-mini to be priced")
	}
	// 0.5M*0.25 + 0.5M*0.025 + 1M*2 = 0.125 + 0.0125 + 2 = 2.1375
	if cost < 2.13 || cost > 2.14 {
		t.Fatalf("cost=%f want ~2.1375", cost)
	}

	// codex-mini-latest normalizes to codex-mini (was previously unpriced).
	cost, ok = estimateCost(d, "codex-mini-latest")
	if !ok {
		t.Fatal("expected codex-mini-latest to be priced")
	}
	// 0.5M*1.5 + 0.5M*0.375 + 1M*6 = 0.75 + 0.1875 + 6 = 6.9375
	if cost < 6.93 || cost > 6.94 {
		t.Fatalf("cost=%f want ~6.9375", cost)
	}

	if _, ok := estimateCost(d, "totally-unknown-model"); ok {
		t.Fatal("unknown model should be unpriced")
	}
}

func TestSubagentSourceDetection(t *testing.T) {
	if !isSubagentSource(`{"subagent":{"thread_spawn":{"depth":1}}}`) {
		t.Fatal("should detect subagent")
	}
	if isSubagentSource("cli") || isSubagentSource("vscode") {
		t.Fatal("normal sources must not be flagged")
	}
}
