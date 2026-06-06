import { promises as fs } from "node:fs";
import OpenAI from "openai";
import type { SolverResult, TaskType, Confidence } from "./types.js";

interface SolverOptions {
  codingStack: string;
  prompt?: string;
}

const SYSTEM_PROMPT = `You are Athena, a high-accuracy visual task-solving assistant. Analyze the screenshots carefully. They may be consecutive captures of one scrollable problem, shown in chronological order from top to bottom. Merge repeated/overlapping content, reconstruct the full task, and use all visible instructions, constraints, text, answer options, code, formulas, images, UI labels, and required output format. Then solve the task in the most useful way.

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

export async function solveScreenshot(
  imagePath: string,
  options: SolverOptions
): Promise<SolverResult & { rawModelOutput: string }> {
  return solveScreenshots([imagePath], options);
}

export async function solveScreenshots(
  imagePaths: string[],
  options: SolverOptions
): Promise<SolverResult & { rawModelOutput: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  if (imagePaths.length === 0) {
    throw new Error("No screenshots were provided for analysis");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const client = new OpenAI({ apiKey });
  const images = await Promise.all(
    imagePaths.map(async (imagePath, index) => {
      const image = await fs.readFile(imagePath);
      return {
        index,
        imageUrl: `data:image/png;base64,${image.toString("base64")}`
      };
    })
  );

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
          {
            type: "input_text",
            text: [
              `Solve the task visible across these ${images.length} screenshot(s). They are ordered by capture time while the user may be scrolling through the same problem.`,
              "Treat overlapping text as duplicate context, not separate questions.",
              "If later screenshots contain answer choices, combine them with the earlier problem statement before choosing an answer.",
              options.prompt ? `User prompt: ${options.prompt}` : "",
              "Return valid JSON only.",
              `If the visible task is a coding challenge, use this requested language or stack for the solution: ${options.codingStack}.`,
              "If the screenshot explicitly requires a different language, follow the screenshot and mention the conflict briefly in the explanation."
            ].filter(Boolean).join("\n")
          },
          ...images.flatMap((image) => [
            { type: "input_text" as const, text: `Screenshot ${image.index + 1} of ${images.length}` },
            { type: "input_image" as const, image_url: image.imageUrl, detail: "auto" as const }
          ])
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
