"use client";

import type { MigrationStep } from "@/lib/scripts";
import type { StepState } from "./Dashboard";

interface Props {
  steps: MigrationStep[];
  stepStates: Record<string, StepState>;
  activeView: number;
  onViewChange: (view: number) => void;
}

export default function Sidebar({ steps, stepStates, activeView, onViewChange }: Props) {
  const items = [
    { label: "Configure", stepId: null as string | null },
    ...steps.map((s) => ({ label: s.sidebarName, stepId: s.id })),
  ];

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
      <div className="px-5 pt-6 pb-3">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          Migration Steps
        </p>
      </div>
      <nav className="flex-1 pb-4">
        {items.map((item, i) => {
          const isActive = i === activeView;
          const state = item.stepId ? stepStates[item.stepId] : null;
          const isComplete = state?.status === "complete";
          const isRunning = state?.status === "running";
          const isError = state?.status === "error";

          return (
            <button
              key={i}
              onClick={() => onViewChange(i)}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-left text-sm transition-colors border-l-[3px] ${isActive ? "bg-blue-50 text-blue-700 border-blue-600 font-medium" : "text-gray-600 hover:bg-gray-50 border-transparent"}`}
            >
              <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${isComplete ? "bg-green-100 text-green-600" : isRunning ? "bg-blue-100 text-blue-600" : isError ? "bg-red-100 text-red-600" : isActive ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                {isComplete ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : isRunning ? (
                  <span className="block w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                ) : isError ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
