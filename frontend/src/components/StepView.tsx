"use client";

import { useState, useEffect } from "react";
import type { MigrationStep } from "@/lib/scripts";
import { STEP_STATS } from "@/lib/scripts";
import type { StepState, LogEntry } from "./Dashboard";
import LogViewer from "./LogViewer";

interface Props {
  step: MigrationStep;
  state: StepState;
  isAnyRunning: boolean;
  logs: LogEntry[];
  onRun: () => void;
  onRunNext: () => void;
  onClearLogs: () => void;
  onNext: () => void;
  hasNext: boolean;
  nextStepName: string;
  totalElapsedMs?: number | null;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function getCardValue(state: StepState, key: string): number {
  if (key in state.counters) return state.counters[key];
  if (key === "migrated") return state.stats.migrated;
  if (key === "skipped") return state.stats.skipped;
  if (key === "failed") return state.stats.failed;
  if (key === "total") return state.stats.total;
  if (key === "created") return state.stats.migrated;
  if (key === "existing") return state.stats.skipped;
  if (key === "taxonomies") return (state.counters.categories || 0) + (state.counters.tags || 0);
  return 0;
}

const colorMap: Record<string, string> = {
  amber: "text-amber-500",
  blue: "text-blue-600",
  emerald: "text-emerald-500",
  slate: "text-gray-400",
  red: "text-red-500",
  purple: "text-purple-500",
};

export default function StepView({
  step,
  state,
  isAnyRunning,
  logs,
  onRun,
  onRunNext,
  onClearLogs,
  onNext,
  hasNext,
  nextStepName,
  totalElapsedMs,
}: Props) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
  }, []);
  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  const elapsed = state.startedAt ? (state.completedAt || now) - state.startedAt : 0;
  const statDefs = STEP_STATS[step.id] || [];

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-900">{step.name}</h1>
        <p className="text-gray-500 mt-1 text-sm">{step.description}</p>

        {/* Stat Cards */}
        {statDefs.length > 0 && (
          <div className="flex gap-4 mt-6">
            {statDefs.map((def) => {
              const value = getCardValue(state, def.key);
              return (
                <div
                  key={def.key}
                  className="flex-1 bg-white rounded-xl border border-gray-200 px-5 py-5 text-center"
                >
                  <p className={`text-3xl font-bold tabular-nums ${colorMap[def.color] || "text-gray-900"}`}>
                    {value}
                  </p>
                  <p className="text-[11px] font-semibold text-gray-400 mt-1.5 uppercase tracking-wider">
                    {def.label}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Status + Log Terminal */}
        <div className="bg-white rounded-xl border border-gray-200 mt-6 overflow-hidden shadow-sm">
          {/* Status bar */}
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {state.status === "running" && (
                <span className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              )}
              {state.status === "complete" && (
                <span className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              )}
              {state.status === "error" && (
                <span className="w-5 h-5 bg-red-100 rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
              )}
              <span className="text-sm font-medium text-gray-700">
                {state.status === "running"
                  ? state.phase || "Running..."
                  : state.status === "complete"
                    ? "Completed successfully"
                    : state.status === "error"
                      ? "Failed"
                      : "Ready to run"}
              </span>
              {elapsed > 0 && (
                <span className="text-xs text-gray-400 tabular-nums">{formatDuration(elapsed)}</span>
              )}
            </div>
            {state.status === "complete" && hasNext ? (
              <button
                onClick={onRunNext}
                disabled={isAnyRunning}
                className="px-5 py-2 rounded-lg text-sm font-semibold transition-all bg-blue-600 text-white hover:bg-blue-700 shadow-sm active:scale-[0.98] disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                Run Next Step &rarr;
              </button>
            ) : (
              <button
                onClick={onRun}
                disabled={isAnyRunning}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${state.status === "running" ? "bg-blue-50 text-blue-400 cursor-wait" : isAnyRunning ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700 shadow-sm active:scale-[0.98]"}`}
              >
                {state.status === "running" ? "Running..." : state.status === "error" ? "Retry Step" : "Run Step"}
              </button>
            )}
          </div>

          {/* Progress bar */}
          {state.progress && (
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                <span>
                  {state.progress.current} / {state.progress.total}
                </span>
                <span>{state.progress.percent}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${Math.min(state.progress.percent, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Log Terminal */}
          <LogViewer logs={logs} onClear={onClearLogs} />
        </div>

        {/* Completed: all done */}
        {state.status === "complete" && !hasNext && (
          <div className="mt-5 px-5 py-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3">
            <span className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span className="text-sm font-medium text-green-700">
              Migration complete! All steps finished successfully.
              {totalElapsedMs != null && ` Total time: ${formatDuration(totalElapsedMs)}.`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
