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

export interface CaptureImage {
  id: string;
  createdAt: string;
  path: string;
}

export interface SolverSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  codingStack: string;
  captures: CaptureImage[];
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
