import "dotenv/config";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAllSessions, getLatestSession, getSession, saveSession } from "./sessionStore.js";
import { solveScreenshots } from "./openaiSolver.js";
import type { CaptureRequest, SolverSession } from "./types.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({ path: path.resolve(apiRoot, "../../.env") });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const webBaseUrl = process.env.WEB_BASE_URL || "http://localhost:5173";
const uploadsDir = path.resolve(apiRoot, "uploads");
const defaultAnalysisDelayMs = Number(process.env.ANALYSIS_DELAY_MS || 2500);
const analysisTimers = new Map<string, NodeJS.Timeout>();
const captureRequestClaimTimeoutMs = Number(process.env.CAPTURE_REQUEST_CLAIM_TIMEOUT_MS || 15_000);

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

app.post("/api/take-screenshot", async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const codingStack = sanitizePreference(req.body?.codingStack, "TypeScript");
    const existingSessionId = sanitizeOptionalId(req.body?.sessionId);
    const existingSession = existingSessionId ? await getSession(existingSessionId) : null;
    const session =
      existingSession ||
      createSession({
        now,
        codingStack,
        status: "collecting",
        finalAnswer: "Waiting for screenshots..."
      });

    const request: CaptureRequest = {
      id: randomUUID(),
      sessionId: session.id,
      createdAt: now,
      claimedAt: null
    };
    await saveSession({
      ...session,
      updatedAt: now,
      status: "collecting",
      captureRequests: [...(session.captureRequests || []), request]
    });

    res.status(202).json({
      requestId: request.id,
      session: publicSession({
        ...session,
        updatedAt: now,
        status: "collecting",
        captureRequests: [...(session.captureRequests || []), request]
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/capture-requests/next", async (_req, res, next) => {
  try {
    const sessions = await getAllSessions();
    const nowMs = Date.now();
    for (const { session } of sessions) {
      const request = (session.captureRequests || []).find((candidate) => {
        if (!candidate.claimedAt) {
          return true;
        }

        return nowMs - new Date(candidate.claimedAt).getTime() > captureRequestClaimTimeoutMs;
      });

      if (!request) {
        continue;
      }

      const claimedRequest = { ...request, claimedAt: new Date().toISOString() };
      await saveSession({
        ...session,
        updatedAt: claimedRequest.claimedAt,
        captureRequests: (session.captureRequests || []).map((candidate) =>
          candidate.id === request.id ? claimedRequest : candidate
        )
      });

      res.json(claimedRequest);
      return;
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
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
    const deferAnalysis = sanitizeBoolean(req.body?.deferAnalysis);
    const requestId = sanitizeOptionalId(req.body?.requestId);
    const capture = { id: randomUUID(), createdAt: now, path: req.file.path };
    let session: SolverSession = existingSession
      ? {
          ...existingSession,
          updatedAt: now,
          status: deferAnalysis ? "collecting" : "processing",
          codingStack,
          captures: [...(existingSession.captures || []), capture],
          finalAnswer: deferAnalysis
            ? `Received ${(existingSession.captures || []).length + 1} screenshots. Add more or press Solve.`
            : existingSession.finalAnswer || `Received ${(existingSession.captures || []).length + 1} screenshots. Waiting for more context...`,
          error: null
        }
      : createSession({
          now,
          codingStack,
          status: deferAnalysis ? "collecting" : "processing",
          captures: [capture],
          finalAnswer: deferAnalysis ? "Received 1 screenshot. Add more or press Solve." : "Received 1 screenshot. Waiting briefly for more context..."
        });
    if (requestId) {
      session = {
        ...session,
        captureRequests: (session.captureRequests || []).filter((request) => request.id !== requestId)
      };
    }

    await saveSession(session);
    const webUrl = `${webBaseUrl.replace(/\/$/, "")}/session/${session.id}`;
    res.status(existingSession ? 200 : 202).json({
      sessionId: session.id,
      status: session.status,
      webUrl,
      captureCount: session.captures.length
    });

    if (!deferAnalysis) {
      scheduleSessionProcessing(session.id, analysisDelayMs);
    }
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

app.get("/api/sessions/:sessionId/captures/:captureId/image", async (req, res) => {
  const session = await getSession(req.params.sessionId);
  const capture = session?.captures.find((candidate) => candidate.id === req.params.captureId);
  if (!capture) {
    res.status(404).json({ error: "Capture not found" });
    return;
  }

  res.sendFile(capture.path);
});

app.post("/api/sessions/:sessionId/solve", async (req, res, next) => {
  try {
    const session = await getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if ((session.captures || []).length === 0) {
      res.status(400).json({ error: "Take at least one screenshot before solving." });
      return;
    }

    const now = new Date().toISOString();
    const updated: SolverSession = {
      ...session,
      updatedAt: now,
      status: "processing",
      codingStack: sanitizePreference(req.body?.codingStack, session.codingStack),
      prompt: sanitizePrompt(req.body?.prompt),
      finalAnswer: "Analyzing screenshots...",
      explanation: "",
      copyReadyOutput: "",
      rawModelOutput: "",
      error: null
    };
    await saveSession(updated);

    res.status(202).json(publicSession(updated));
    void processSession(updated.id);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:sessionId/reset", async (req, res, next) => {
  try {
    const session = await getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const timer = analysisTimers.get(session.id);
    if (timer) {
      clearTimeout(timer);
      analysisTimers.delete(session.id);
    }

    await Promise.all(
      (session.captures || []).map(async (capture) => {
        try {
          await fs.unlink(capture.path);
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? error.code : null;
          if (code !== "ENOENT") {
            throw error;
          }
        }
      })
    );

    const resetSession: SolverSession = {
      ...session,
      updatedAt: new Date().toISOString(),
      status: "collecting",
      captures: [],
      captureRequests: [],
      taskType: "UNKNOWN",
      confidence: "low",
      finalAnswer: "Screenshots cleared. Take a screenshot to start again.",
      explanation: "",
      copyReadyOutput: "",
      rawModelOutput: "",
      error: null,
      prompt: ""
    };

    await saveSession(resetSession);
    res.json(publicSession(resetSession));
  } catch (error) {
    next(error);
  }
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
      { codingStack: session.codingStack, prompt: session.prompt }
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

function createSession({
  now,
  codingStack,
  status,
  captures = [],
  finalAnswer
}: {
  now: string;
  codingStack: string;
  status: SolverSession["status"];
  captures?: SolverSession["captures"];
  finalAnswer: string;
}): SolverSession {
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status,
    codingStack,
    captures,
    captureRequests: [],
    taskType: "UNKNOWN",
    confidence: "low",
    finalAnswer,
    explanation: "",
    copyReadyOutput: "",
    rawModelOutput: "",
    error: null
  };
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

function sanitizeBoolean(value: unknown) {
  return value === true || value === "true" || value === "1";
}

function sanitizePrompt(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 4000);
}

function publicSession(session: SolverSession) {
  return {
    ...session,
    captures: (session.captures || []).map((capture) => ({
      id: capture.id,
      createdAt: capture.createdAt,
      thumbnailUrl: `/api/sessions/${session.id}/captures/${capture.id}/image`
    })),
    captureRequests: (session.captureRequests || []).map((request) => ({
      id: request.id,
      sessionId: request.sessionId,
      createdAt: request.createdAt,
      claimedAt: request.claimedAt
    }))
  };
}
