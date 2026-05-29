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
import { solveScreenshot } from "./openaiSolver.js";
import type { SolverSession } from "./types.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({ path: path.resolve(apiRoot, "../../.env") });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const webBaseUrl = process.env.WEB_BASE_URL || "http://localhost:5173";
const uploadsDir = path.resolve(apiRoot, "uploads");

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

    const session: SolverSession = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: "processing",
      taskType: "UNKNOWN",
      confidence: "low",
      finalAnswer: "",
      explanation: "",
      copyReadyOutput: "",
      rawModelOutput: "",
      error: null
    };

    await saveSession(session);
    const webUrl = `${webBaseUrl.replace(/\/$/, "")}/session/${session.id}`;
    res.status(202).json({ sessionId: session.id, status: session.status, webUrl });

    void processSession(session, req.file.path);
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
  res.json(session);
});

app.get("/api/sessions/:sessionId", async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(session);
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`Athena API listening on http://localhost:${port}`);
});

async function processSession(session: SolverSession, imagePath: string) {
  try {
    const result = await solveScreenshot(imagePath);
    await saveSession({
      ...session,
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
    await saveSession({
      ...session,
      status: "failed",
      error: message,
      finalAnswer: message,
      explanation: "",
      copyReadyOutput: "",
      rawModelOutput: ""
    });
  }
}
