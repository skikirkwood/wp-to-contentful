"use client";

import { useEffect, useRef } from "react";
import type { LogEntry } from "./Dashboard";

interface Props {
  logs: LogEntry[];
  onClear: () => void;
}

const levelStyles: Record<string, string> = {
  info: "text-gray-300",
  success: "text-green-400",
  error: "text-red-400",
  warning: "text-yellow-400",
};

export default function LogViewer({ logs, onClear }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !autoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div className="bg-[#1a1d23] border-t border-gray-800">
      {/* Terminal header */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-gray-800/50">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="text-xs text-gray-500 ml-2 font-medium">Output</span>
          <span className="text-[10px] text-gray-600">({logs.length})</span>
        </div>
        <button
          onClick={onClear}
          className="text-[11px] text-gray-500 hover:text-gray-300 px-2 py-0.5 rounded hover:bg-white/5 transition"
        >
          Clear
        </button>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="log-terminal overflow-y-auto p-4 font-mono text-xs leading-relaxed min-h-[220px] max-h-[400px]"
      >
        {logs.length === 0 ? (
          <p className="text-gray-600 select-none">Run a step to see output...</p>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className={`flex gap-2 ${levelStyles[entry.level]}`}>
              <span className="flex-shrink-0 text-gray-600 select-none tabular-nums" suppressHydrationWarning>
                {new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false })}
              </span>
              <span className="whitespace-pre-wrap break-all">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
