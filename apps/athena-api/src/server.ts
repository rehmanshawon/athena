import "dotenv/config";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { getLatestSession, getSession, saveSession } from "./sessionStore.js";
import { solveScreenshots } from "./openaiSolver.js";
import type { SolverSession } from "./types.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({ path: path.resolve(apiRoot, "../../.env") });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const webBaseUrl = process.env.WEB_BASE_URL || "http://localhost:5173";
const uploadsDir = path.resolve(apiRoot, "uploads");
const defaultAnalysisDelayMs = Number(process.env.ANALYSIS_DELAY_MS || 2500);
const analysisTimers = new Map<string, NodeJS.Timeout>();

await fs.mkdir(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname) || ".png";
      cb(null, `${Date.now()}-${randomUUID()}${extension}`);
    }
  }),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image uploads are supported"));
    }
  }
});

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "athena-api" });
});

app.post("/api/captures", upload.single("screenshot"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Missing multipart field: screenshot" });
      return;
    }

    const now = new Date().toISOString();
    const codingStack = sanitizePreference(req.body?.codingStack, "TypeScript");
    const existingSessionId = sanitizeOptionalId(req.body?.sessionId);
    const existingSession = existingSessionId ? await getSession(existingSessionId) : null;
    const analysisDelayMs = sanitizeDelayMs(req.body?.analysisDelayMs, defaultAnalysisDelayMs);
    const capture = { id: randomUUID(), createdAt: now, path: req.file.path };
    const session: SolverSession = existingSession
      ? {
          ...existingSession,
          updatedAt: now,
          status: "processing",
          codingStack,
          captures: [...(existingSession.captures || []), capture],
          finalAnswer: existingSession.finalAnswer || `Received ${(existingSession.captures || []).length + 1} screenshots. Waiting for more context...`,
          error: null
        }
      : {
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          status: "processing",
          codingStack,
          captures: [capture],
          taskType: "UNKNOWN",
          confidence: "low",
          finalAnswer: "Received 1 screenshot. Waiting briefly for more context...",
          explanation: "",
          copyReadyOutput: "",
          rawModelOutput: "",
          error: null
        };

    await saveSession(session);
    const webUrl = `${webBaseUrl.replace(/\/$/, "")}/session/${session.id}`;
    res.status(existingSession ? 200 : 202).json({
      sessionId: session.id,
      status: session.status,
      webUrl,
      captureCount: session.captures.length
    });

    scheduleSessionProcessing(session.id, analysisDelayMs);
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions/latest", async (_req, res) => {
  const session = await getLatestSession();
  if (!session) {
    res.status(404).json({ error: "No sessions found" });
    return;
  }
  res.json(publicSession(session));
});

app.get("/api/sessions/:sessionId", async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(publicSession(session));
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`Athena API listening on http://localhost:${port}`);
});

function scheduleSessionProcessing(sessionId: string, delayMs: number) {
  const existingTimer = analysisTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    analysisTimers.delete(sessionId);
    void processSession(sessionId);
  }, delayMs);

  analysisTimers.set(sessionId, timer);
}

async function processSession(sessionId: string) {
  const session = await getSession(sessionId);
  if (!session) {
    return;
  }

  const captures = session.captures || [];
  const captureCount = captures.length;

  try {
    const result = await solveScreenshots(
      captures.map((capture) => capture.path),
      { codingStack: session.codingStack }
    );
    const latest = await getSession(session.id);
    if (!latest || (latest.captures || []).length !== captureCount) {
      return;
    }

    await saveSession({
      ...latest,
      updatedAt: new Date().toISOString(),
      status: "completed",
      taskType: result.taskType,
      confidence: result.confidence,
      finalAnswer: result.finalAnswer,
      explanation: result.explanation,
      copyReadyOutput: result.copyReadyOutput,
      rawModelOutput: result.rawModelOutput,
      error: null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI processing failed";
    const latest = await getSession(session.id);
    if (!latest || (latest.captures || []).length !== captureCount) {
      return;
    }

    await saveSession({
      ...latest,
      updatedAt: new Date().toISOString(),
      status: "failed",
      error: message,
      finalAnswer: message,
      explanation: "",
      copyReadyOutput: "",
      rawModelOutput: ""
    });
  }
}

function sanitizePreference(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.slice(0, 80);
}

function sanitizeOptionalId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !/^[a-f0-9-]{8,}$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function sanitizeDelayMs(value: unknown, fallback: number) {
  const numeric = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(60_000, Math.round(numeric)));
}

function publicSession(session: SolverSession) {
  return {
    ...session,
    captures: (session.captures || []).map((capture) => ({
      id: capture.id,
      createdAt: capture.createdAt
    }))
  };
}
