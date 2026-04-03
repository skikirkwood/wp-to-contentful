export type LogLevel = "info" | "success" | "error" | "warning";

export interface ParsedLine {
  level: LogLevel;
  message: string;
  progressUpdate?: { current: number; total: number; percent: number };
  statsUpdate?: { migrated?: number; skipped?: number; failed?: number; total?: number };
  phase?: string;
  counterUpdate?: Record<string, number>;
  counterIncrement?: Record<string, number>;
}

export function parseLine(raw: string): ParsedLine {
  const line = raw.trimEnd();
  if (!line) return { level: "info", message: "" };

  // Success markers
  if (line.includes("✓") || line.includes("✔")) {
    const contentMatch = line.match(/[✓✔]\s+(Author|Category|Tag|Post|Page|Media):/i);
    if (contentMatch) {
      const pluralMap: Record<string, string> = {
        author: "authors",
        category: "categories",
        tag: "tags",
        post: "posts",
        page: "pages",
        media: "media",
      };
      const key = pluralMap[contentMatch[1].toLowerCase()];
      if (key) {
        return { level: "success", message: line, counterIncrement: { [key]: 1 } };
      }
    }
    return { level: "success", message: line };
  }

  // Failure markers
  if (line.includes("✗") || line.includes("✘") || line.startsWith("Error:")) {
    return { level: "error", message: line };
  }

  // Skip markers
  if (line.includes("⊘")) {
    return { level: "warning", message: line };
  }

  // Warning markers
  if (line.includes("Warning:") || line.includes("[warning]") || line.includes("⚠")) {
    return { level: "warning", message: line };
  }

  // Export/validation summary counters: "  Pages:      5" or "  - posts: 156"
  const exportCountMatch = line.match(/^\s+(?:-\s+)?(posts|pages|media|users|categories|tags):\s*(\d+)/i);
  if (exportCountMatch) {
    return {
      level: "info",
      message: line,
      counterUpdate: { [exportCountMatch[1].toLowerCase()]: parseInt(exportCountMatch[2]) },
    };
  }

  // Content migration summary: "  Authors:    1/3 (0 failed)"
  const migrationSummaryMatch = line.match(/^\s+(Authors|Categories|Tags|Posts|Pages):\s*(\d+)\/(\d+)/);
  if (migrationSummaryMatch) {
    return {
      level: "info",
      message: line,
      counterUpdate: { [migrationSummaryMatch[1].toLowerCase()]: parseInt(migrationSummaryMatch[2]) },
    };
  }

  // Validation: "Overall migration: 100/105 entries"
  const validationMatch = line.match(/Overall migration:\s*(\d+)\/(\d+)/);
  if (validationMatch) {
    return {
      level: "info",
      message: line,
      counterUpdate: {
        migrated: parseInt(validationMatch[1]),
        expected: parseInt(validationMatch[2]),
      },
    };
  }

  // Validation: "Issues found: 2"
  const issuesMatch = line.match(/Issues found:\s*(\d+)/);
  if (issuesMatch) {
    return {
      level: "info",
      message: line,
      counterUpdate: { issues: parseInt(issuesMatch[1]) },
    };
  }

  // Progress: X/Y (Z%)
  const progressPct = line.match(/Progress:\s*(\d+)\/(\d+)\s*\((\d+)%\)/);
  if (progressPct) {
    return {
      level: "info",
      message: line,
      progressUpdate: {
        current: parseInt(progressPct[1]),
        total: parseInt(progressPct[2]),
        percent: parseInt(progressPct[3]),
      },
    };
  }

  // Progress: X/Y
  const progressSimple = line.match(/Progress:\s*(\d+)\/(\d+)/);
  if (progressSimple) {
    const c = parseInt(progressSimple[1]);
    const t = parseInt(progressSimple[2]);
    return {
      level: "info",
      message: line,
      progressUpdate: { current: c, total: t, percent: t > 0 ? Math.round((c / t) * 100) : 0 },
    };
  }

  // Page X/Y (Z/W items) — export pagination
  const pageProg = line.match(/Page\s+(\d+)\/(\d+)\s+\((\d+)\/(\d+)\s+items\)/);
  if (pageProg) {
    const c = parseInt(pageProg[3]);
    const t = parseInt(pageProg[4]);
    return {
      level: "info",
      message: line,
      progressUpdate: { current: c, total: t, percent: t > 0 ? Math.round((c / t) * 100) : 0 },
    };
  }

  // "Found X media items to migrate"
  const foundItems = line.match(/Found\s+(\d+)\s+media\s+items/);
  if (foundItems) {
    return {
      level: "info",
      message: line,
      statsUpdate: { total: parseInt(foundItems[1]) },
    };
  }

  // Final stats blocks: "  Migrated: 5"
  const statLine = line.match(/^\s*(Total|Migrated|Skipped|Failed):\s*(\d+)/i);
  if (statLine) {
    const key = statLine[1].toLowerCase() as "total" | "migrated" | "skipped" | "failed";
    return {
      level: "info",
      message: line,
      statsUpdate: { [key]: parseInt(statLine[2]) },
    };
  }

  // Phase headers: "1. Migrating Authors"
  const phaseMatch = line.match(/^\d+\.\s+Migrating\s+(.+)/);
  if (phaseMatch) {
    return { level: "info", message: line, phase: phaseMatch[1].trim() };
  }

  // Section headers
  if (line.match(/^(Exporting|Checking|Contentful|WordPress|Migration|Validation|=== Phase)/)) {
    return { level: "info", message: line, phase: line.replace(/^=+\s*/, "").replace(/\s*=+$/, "").trim() };
  }

  return { level: "info", message: line };
}
