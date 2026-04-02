import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

function getEnvPath(): string {
  const root = process.env.PROJECT_ROOT || path.resolve(process.cwd(), "..");
  return path.join(root, ".env");
}

function parseEnvFile(content: string): Record<string, string> {
  const config: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    config[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return config;
}

export async function GET() {
  const envPath = getEnvPath();
  if (!existsSync(envPath)) {
    return Response.json({ error: ".env file not found" }, { status: 404 });
  }
  const content = readFileSync(envPath, "utf-8");
  return Response.json(parseEnvFile(content));
}

export async function POST(request: Request) {
  const updates = (await request.json()) as Record<string, string>;
  const envPath = getEnvPath();

  const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const lines = existing.split("\n");
  const updatedKeys = new Set<string>();

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key in updates) {
      updatedKeys.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  writeFileSync(envPath, newLines.join("\n"));
  return Response.json({ success: true });
}
