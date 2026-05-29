import { promises as fs } from "node:fs";
import OpenAI from "openai";
import type { SolverResult, TaskType, Confidence } from "./types.js";

const SYSTEM_PROMPT = `You are Athena, a high-accuracy visual task-solving assistant. Analyze the screenshot carefully. Identify what kind of task is visible. Extract all important instructions, constraints, visible text, answer options, code, formulas, images, UI labels, and required output format. Then solve the task in the most useful way.

Handle these task types:

1. PRD or product requirement writing:
   Produce a human-written, senior tech-lead style PRD. Be specific, concrete, and implementation-oriented. Avoid generic AI-sounding filler. Respect visible word limits and platform constraints. Include pages, navigation, user roles, data model, interactions, validation, empty/error states, responsive behavior, and tech stack when relevant.

2. LaTeX syntax correction:
   Find syntax or formatting errors. Provide corrected LaTeX and brief explanations. Preserve the intended meaning.

3. CCAT/IQ/aptitude multiple choice:
   Solve carefully. Give the final answer choice clearly and include brief reasoning.

4. Coding challenge:
   Extract the problem. Provide algorithm, complexity, edge cases, and clean working code. Prefer TypeScript unless another language is clearly required.

5. Visual symbol/pattern reasoning:
   Compare shape, rotation, count, fill, symmetry, sequence, position, and relationships. Give the best answer and confidence.

6. General:
   Follow the visible task instruction and provide a direct useful answer.

Output must be valid JSON only, no markdown fences:
{
"taskType": "PRD | LATEX | CCAT | CODING | VISUAL_REASONING | GENERAL | UNKNOWN",
"confidence": "low | medium | high",
"finalAnswer": "...",
"explanation": "...",
"copyReadyOutput": "..."
}

If information is missing or unreadable, still provide the best possible answer and mention uncertainty briefly.`;

const taskTypes = new Set<TaskType>([
  "PRD",
  "LATEX",
  "CCAT",
  "CODING",
  "VISUAL_REASONING",
  "GENERAL",
  "UNKNOWN"
]);

const confidences = new Set<Confidence>(["low", "medium", "high"]);

export async function solveScreenshot(imagePath: string): Promise<SolverResult & { rawModelOutput: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const client = new OpenAI({ apiKey });
  const image = await fs.readFile(imagePath);
  const imageUrl = `data:image/png;base64,${image.toString("base64")}`;

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }]
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Solve the task visible in this screenshot. Return valid JSON only." },
          { type: "input_image", image_url: imageUrl, detail: "auto" }
        ]
      }
    ],
    temperature: 0.2
  });

  const rawModelOutput = response.output_text?.trim() || "";
  const parsed = parseSolverJson(rawModelOutput);
  return { ...parsed, rawModelOutput };
}

function parseSolverJson(raw: string): SolverResult {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const value = JSON.parse(cleaned) as Partial<SolverResult>;
    const taskType = taskTypes.has(value.taskType as TaskType) ? (value.taskType as TaskType) : "UNKNOWN";
    const confidence = confidences.has(value.confidence as Confidence) ? (value.confidence as Confidence) : "low";
    return {
      taskType,
      confidence,
      finalAnswer: stringValue(value.finalAnswer),
      explanation: stringValue(value.explanation),
      copyReadyOutput: stringValue(value.copyReadyOutput || value.finalAnswer)
    };
  } catch {
    return {
      taskType: "UNKNOWN",
      confidence: "low",
      finalAnswer: raw || "The model returned an empty response.",
      explanation: "The model response could not be parsed as JSON.",
      copyReadyOutput: raw || ""
    };
  }
}

function stringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "";
  }

  return JSON.stringify(value, null, 2);
}
