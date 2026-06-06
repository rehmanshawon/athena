import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SolverSession } from "./types.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionsDir = path.resolve(apiRoot, "data", "sessions");

export async function ensureSessionStorage() {
  await fs.mkdir(sessionsDir, { recursive: true });
}

export async function saveSession(session: SolverSession) {
  await ensureSessionStorage();
  const filePath = path.join(sessionsDir, `${session.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf8");
}

export async function getSession(sessionId: string): Promise<SolverSession | null> {
  try {
    const filePath = path.join(sessionsDir, `${sessionId}.json`);
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data) as SolverSession;
  } catch {
    return null;
  }
}

export async function getLatestSession(): Promise<SolverSession | null> {
  const sessions = await getAllSessions();
  return sessions[0]?.session || null;
}

export async function getAllSessions(): Promise<Array<{ session: SolverSession; filePath: string; mtimeMs: number }>> {
  await ensureSessionStorage();
  const files = await fs.readdir(sessionsDir);
  const jsonFiles = files.filter((file) => file.endsWith(".json"));
  if (jsonFiles.length === 0) {
    return [];
  }

  const sessions = await Promise.all(
    jsonFiles.map(async (file) => {
      const filePath = path.join(sessionsDir, file);
      const stat = await fs.stat(filePath);
      const data = await fs.readFile(filePath, "utf8");
      return { session: JSON.parse(data) as SolverSession, filePath, mtimeMs: stat.mtimeMs };
    })
  );

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions;
}
