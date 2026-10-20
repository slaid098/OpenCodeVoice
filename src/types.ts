export type InsertTarget = "composer" | "question";

export type SttProviderId = "groq" | "openai" | "custom";

export type LlmProviderId = "ollama-cloud" | "ollama-local" | "custom-openai";

export type DictationPhase = "idle" | "recording" | "stt" | "llm" | "insert" | "submit";

export type FailureStage = "stt" | "llm" | "insert" | "submit";

export interface SttConfig {
  provider: SttProviderId;
  endpoint: string;
  apiKey: string;
  model: string;
  language: string;
  prompt: string;
  temperature: number;
}

export interface LlmConfig {
  enabled: boolean;
  provider: LlmProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoning: boolean;
  prompt: string;
}

export interface BehaviorConfig {
  autoSubmit: boolean;
  autoSubmitQuestion: boolean;
  fallbackToRaw: boolean;
  saveFailedAudio: boolean;
  maxRecordingSeconds: number;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface AppConfig {
  schemaVersion: 2;
  stt: SttConfig;
  llm: LlmConfig;
  behavior: BehaviorConfig;
  retry: RetryConfig;
}

export interface TranscriptionResult {
  text: string;
  provider: SttProviderId;
  model: string;
}

export interface CleanupResult {
  text: string;
  fallback: boolean;
  reason?: string;
  usedDefaultPrompt: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
}

export interface FailedDictation {
  id: string;
  createdAt: number;
  updatedAt: number;
  target: InsertTarget;
  stage: FailureStage;
  audio?: ArrayBuffer;
  audioMimeType?: string;
  rawText?: string;
  cleanText?: string;
  rawInserted?: boolean;
  error: string;
  attempts: number;
  provider?: string;
  model?: string;
}

export interface SelectorStatus {
  composerDock: boolean;
  composerEditor: boolean;
  composerActions: boolean;
  composerSubmit: boolean;
  questionDock: boolean;
  questionInput: boolean;
  questionFooter: boolean;
}
