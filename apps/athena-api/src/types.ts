export type TaskType =
  | "PRD"
  | "LATEX"
  | "CCAT"
  | "CODING"
  | "VISUAL_REASONING"
  | "GENERAL"
  | "UNKNOWN";

export type Confidence = "low" | "medium" | "high";
export type SessionStatus = "processing" | "completed" | "failed";

export interface SolverSession {
  id: string;
  createdAt: string;
  status: SessionStatus;
  taskType: TaskType;
  confidence: Confidence;
  finalAnswer: string;
  explanation: string;
  copyReadyOutput: string;
  rawModelOutput: string;
  error: string | null;
}

export interface SolverResult {
  taskType: TaskType;
  confidence: Confidence;
  finalAnswer: string;
  explanation: string;
  copyReadyOutput: string;
}
