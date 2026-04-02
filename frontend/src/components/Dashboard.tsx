"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { STEPS } from "@/lib/scripts";
import Sidebar from "./Sidebar";
import ConfigPanel from "./ConfigPanel";
import StepView from "./StepView";

export interface LogEntry {
  id: number;
  timestamp: number;
  level: "info" | "success" | "error" | "warning";
  message: string;
}

export interface StepState {
  status: "idle" | "running" | "complete" | "error";
  progress: { current: number; total: number; percent: number } | null;
  stats: { migrated: number; skipped: number; failed: number; total: number };
  counters: Record<string, number>;
  phase: string;
  startedAt: number | null;
  completedAt: number | null;
  exitCode: number | null;
  logs: LogEntry[];
}

function initialStepState(): StepState {
  return {
    status: "idle",
    progress: null,
    stats: { migrated: 0, skipped: 0, failed: 0, total: 0 },
    counters: {},
    phase: "",
    startedAt: null,
    completedAt: null,
    exitCode: null,
    logs: [],
  };
}

export default function Dashboard() {
  const [activeView, setActiveView] = useState(0);
  const [stepStates, setStepStates] = useState<Record<string, StepState>>(() =>
    Object.fromEntries(STEPS.map((s) => [s.id, initialStepState()]))
  );
  const logIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const fullRunRef = useRef(false);
  const [autoRunTrigger, setAutoRunTrigger] = useState<string | null>(null);

  const isAnyRunning = Object.values(stepStates).some((s) => s.status === "running");

  const addLog = useCallback((stepId: string, level: LogEntry["level"], message: string) => {
    const entry: LogEntry = { id: ++logIdRef.current, timestamp: Date.now(), level, message };
    setStepStates((prev) => ({
      ...prev,
      [stepId]: {
        ...prev[stepId],
        logs: [...prev[stepId].logs, entry],
      },
    }));
  }, []);

  const handleEvent = useCallback(
    (stepId: string, event: Record<string, unknown>) => {
      switch (event.type) {
        case "log":
          addLog(stepId, event.level as LogEntry["level"], event.message as string);
          if (event.level === "success") {
            setStepStates((prev) => ({
              ...prev,
              [stepId]: {
                ...prev[stepId],
                stats: { ...prev[stepId].stats, migrated: prev[stepId].stats.migrated + 1 },
              },
            }));
          } else if (event.level === "error" && (event.message as string).includes("✗")) {
            setStepStates((prev) => ({
              ...prev,
              [stepId]: {
                ...prev[stepId],
                stats: { ...prev[stepId].stats, failed: prev[stepId].stats.failed + 1 },
              },
            }));
          }
          break;

        case "progress":
          setStepStates((prev) => ({
            ...prev,
            [stepId]: {
              ...prev[stepId],
              progress: {
                current: event.current as number,
                total: event.total as number,
                percent: event.percent as number,
              },
            },
          }));
          break;

        case "stats":
          setStepStates((prev) => {
            const s = { ...prev[stepId].stats };
            if (event.total != null) s.total = event.total as number;
            if (event.migrated != null) s.migrated = event.migrated as number;
            if (event.skipped != null) s.skipped = event.skipped as number;
            if (event.failed != null) s.failed = event.failed as number;
            return { ...prev, [stepId]: { ...prev[stepId], stats: s } };
          });
          break;

        case "counters": {
          const updates = { ...event };
          delete updates.type;
          setStepStates((prev) => ({
            ...prev,
            [stepId]: {
              ...prev[stepId],
              counters: { ...prev[stepId].counters, ...(updates as Record<string, number>) },
            },
          }));
          break;
        }

        case "counter-inc": {
          const incs = { ...event };
          delete incs.type;
          setStepStates((prev) => {
            const current = { ...prev[stepId].counters };
            for (const [k, v] of Object.entries(incs)) {
              current[k] = (current[k] || 0) + (v as number);
            }
            return { ...prev, [stepId]: { ...prev[stepId], counters: current } };
          });
          break;
        }

        case "phase":
          setStepStates((prev) => ({
            ...prev,
            [stepId]: { ...prev[stepId], phase: event.name as string },
          }));
          break;

        case "complete": {
          const exitCode = event.exitCode as number;
          setStepStates((prev) => ({
            ...prev,
            [stepId]: {
              ...prev[stepId],
              status: exitCode === 0 ? "complete" : "error",
              exitCode,
              completedAt: Date.now(),
            },
          }));
          if (fullRunRef.current && exitCode === 0) {
            setAutoRunTrigger(stepId);
          } else if (exitCode !== 0) {
            fullRunRef.current = false;
          }
          break;
        }

        case "error":
          addLog(stepId, "error", event.message as string);
          setStepStates((prev) => ({
            ...prev,
            [stepId]: { ...prev[stepId], status: "error", completedAt: Date.now() },
          }));
          fullRunRef.current = false;
          break;
      }
    },
    [addLog]
  );

  const runStep = useCallback(
    async (stepId: string) => {
      if (isAnyRunning) return;

      setStepStates((prev) => ({
        ...prev,
        [stepId]: {
          ...initialStepState(),
          status: "running",
          startedAt: Date.now(),
        },
      }));

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json();
          addLog(stepId, "error", err.error || "Failed to start script");
          setStepStates((prev) => ({
            ...prev,
            [stepId]: { ...prev[stepId], status: "error", completedAt: Date.now() },
          }));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const chunk of lines) {
            const dataLine = chunk.trim();
            if (!dataLine.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(dataLine.slice(6));
              handleEvent(stepId, event);
            } catch {
              // ignore
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          addLog(stepId, "warning", "Script stopped by user");
          setStepStates((prev) => ({
            ...prev,
            [stepId]: { ...prev[stepId], status: "idle", completedAt: Date.now() },
          }));
        } else {
          addLog(stepId, "error", `Connection error: ${err}`);
          setStepStates((prev) => ({
            ...prev,
            [stepId]: { ...prev[stepId], status: "error", completedAt: Date.now() },
          }));
        }
        fullRunRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAnyRunning]
  );

  // Auto-run next step in full migration (but don't change the view)
  useEffect(() => {
    if (!autoRunTrigger || !fullRunRef.current) return;
    setAutoRunTrigger(null);

    const idx = STEPS.findIndex((s) => s.id === autoRunTrigger);
    if (idx >= 0 && idx < STEPS.length - 1) {
      const next = STEPS[idx + 1];
      const timer = setTimeout(() => runStep(next.id), 600);
      return () => clearTimeout(timer);
    } else {
      fullRunRef.current = false;
    }
  }, [autoRunTrigger, runStep]);

  const stopScript = useCallback(async () => {
    abortRef.current?.abort();
    await fetch("/api/run", { method: "DELETE" });
    fullRunRef.current = false;
  }, []);

  const clearStepLogs = useCallback(
    (stepId: string) => {
      setStepStates((prev) => ({
        ...prev,
        [stepId]: { ...prev[stepId], logs: [] },
      }));
    },
    []
  );

  const startFullMigration = useCallback(() => {
    fullRunRef.current = true;
    setActiveView(1);
    runStep(STEPS[0].id);
  }, [runStep]);

  const activeStepIndex = activeView - 1;
  const currentStep = activeStepIndex >= 0 ? STEPS[activeStepIndex] : null;
  const currentState = currentStep ? stepStates[currentStep.id] : null;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center px-6 flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-sm">C</span>
          </span>
          <span className="font-semibold text-gray-900 text-[15px]">WordPress Migration Tool</span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {isAnyRunning && (
            <button
              onClick={stopScript}
              className="px-3.5 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition"
            >
              Stop
            </button>
          )}
          <span className="flex items-center gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-green-600 font-medium">Connected</span>
          </span>
          <span className="text-xs text-gray-400">v1.0.0</span>
        </div>
      </header>

      {/* Body: Sidebar + Main */}
      <div className="flex-1 flex min-h-0">
        <Sidebar
          steps={STEPS}
          stepStates={stepStates}
          activeView={activeView}
          onViewChange={setActiveView}
        />

        <main className="flex-1 bg-gray-50 min-h-0 flex flex-col">
          {activeView === 0 ? (
            <ConfigPanel />
          ) : currentStep && currentState ? (
            <StepView
              step={currentStep}
              state={currentState}
              isAnyRunning={isAnyRunning}
              logs={currentState.logs}
              onRun={() => runStep(currentStep.id)}
              onRunNext={() => {
                const nextIdx = activeStepIndex + 1;
                if (nextIdx < STEPS.length) {
                  setActiveView(nextIdx + 1);
                  runStep(STEPS[nextIdx].id);
                }
              }}
              onClearLogs={() => clearStepLogs(currentStep.id)}
              onNext={() => setActiveView(activeView + 1)}
              hasNext={activeStepIndex < STEPS.length - 1}
              nextStepName={STEPS[activeStepIndex + 1]?.sidebarName || ""}
            />
          ) : null}
        </main>
      </div>

      {/* Footer */}
      <footer className="h-14 bg-white border-t border-gray-200 flex items-center px-6 flex-shrink-0">
        <div className="text-xs text-gray-400">
          Powered by{" "}
          <span className="text-blue-600 font-medium">wp-to-contentful</span>
          <span className="mx-1.5">&middot;</span>
          Node.js 18+ &middot; MIT License
        </div>
        <div className="ml-auto flex gap-3">
          {!isAnyRunning && (
            <>
              <button
                onClick={startFullMigration}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 shadow-sm transition flex items-center gap-2 active:scale-[0.98]"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.8A1.5 1.5 0 004 4.1v11.8a1.5 1.5 0 002.3 1.3l9.2-5.9a1.5 1.5 0 000-2.6L6.3 2.8z" />
                </svg>
                Start Full Migration
              </button>
              <button
                onClick={() => setActiveView(1)}
                className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
              >
                Run Step-by-Step
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
