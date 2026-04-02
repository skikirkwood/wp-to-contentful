import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { STEPS } from "@/lib/scripts";
import { parseLine } from "@/lib/parse-output";

let runningProcess: ChildProcess | null = null;

export async function POST(request: Request) {
  const { stepId } = await request.json();

  const step = STEPS.find((s) => s.id === stepId);
  if (!step) {
    return Response.json({ error: `Unknown step: ${stepId}` }, { status: 400 });
  }

  if (runningProcess && !runningProcess.killed) {
    return Response.json(
      { error: "A script is already running. Wait for it to finish or stop it first." },
      { status: 409 }
    );
  }

  const projectRoot = process.env.PROJECT_ROOT || path.resolve(process.cwd(), "..");
  const scriptPath = path.join(projectRoot, step.scriptFile);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed
        }
      };

      send({ type: "started", stepId, timestamp: Date.now() });

      const child = spawn(process.execPath, [scriptPath], {
        cwd: projectRoot,
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      runningProcess = child;

      const processLine = (raw: string, isStderr: boolean) => {
        if (!raw.trim()) return;
        const parsed = parseLine(raw);
        send({
          type: "log",
          level: isStderr && parsed.level === "info" ? "warning" : parsed.level,
          message: parsed.message,
          timestamp: Date.now(),
        });
        if (parsed.progressUpdate) {
          send({ type: "progress", ...parsed.progressUpdate });
        }
        if (parsed.statsUpdate) {
          send({ type: "stats", ...parsed.statsUpdate });
        }
        if (parsed.phase) {
          send({ type: "phase", name: parsed.phase });
        }
        if (parsed.counterUpdate) {
          send({ type: "counters", ...parsed.counterUpdate });
        }
        if (parsed.counterIncrement) {
          send({ type: "counter-inc", ...parsed.counterIncrement });
        }
      };

      // Line-buffered processing to handle partial chunks
      let stdoutBuf = "";
      let stderrBuf = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf-8");
        const lines = stdoutBuf.split("\n");
        stdoutBuf = lines.pop() || "";
        for (const line of lines) processLine(line, false);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf-8");
        const lines = stderrBuf.split("\n");
        stderrBuf = lines.pop() || "";
        for (const line of lines) processLine(line, true);
      });

      child.on("close", (code) => {
        // Flush remaining buffered output
        if (stdoutBuf.trim()) processLine(stdoutBuf, false);
        if (stderrBuf.trim()) processLine(stderrBuf, true);

        runningProcess = null;
        send({ type: "complete", exitCode: code ?? 1, timestamp: Date.now() });
        controller.close();
      });

      child.on("error", (err) => {
        runningProcess = null;
        send({ type: "error", message: err.message, timestamp: Date.now() });
        controller.close();
      });
    },
    cancel() {
      if (runningProcess && !runningProcess.killed) {
        runningProcess.kill("SIGTERM");
        runningProcess = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function DELETE() {
  if (runningProcess && !runningProcess.killed) {
    runningProcess.kill("SIGTERM");
    runningProcess = null;
    return Response.json({ stopped: true });
  }
  return Response.json({ stopped: false, message: "No script running" });
}
