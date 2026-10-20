export type InsertTarget = "composer" | "question";

export type Locale = "ru" | "en";

export type LocalePreference = "auto" | Locale;

export type SttProviderId = "groq" | "custom";

export type LlmProviderId = "ollama-cloud" | "ollama-local" | "custom-openai";

export type DictationPhase = "idle" | "recording" | "stt" | "llm" | "insert" | "submit";

export type FailureStage = "stt" | "llm" | "insert" | "submit";

export interface UiConfig {
  language: LocalePreference;
}

export interface SttConfig {
  provider: SttProviderId;
  apiKey: string;
  language: string;
  prompt: string;
  temperature: number;
  groqModel: string;
  customEndpoint: string;
  customModel: string;
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
  ui: UiConfig;
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
  /** Page path where the recording started, e.g. `/server/x/session/y`. */
  originPath?: string;
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
  composerForm: boolean;
  composerEditor: boolean;
  composerActions: boolean;
  composerActionsResolved: boolean;
  composerSubmit: boolean;
  composerMic: boolean;
  composerMicVisible: boolean;
  questionDock: boolean;
  questionInput: boolean;
  questionInputCurrent: boolean;
  questionInputLegacy: boolean;
  questionHeaderActions: boolean;
  questionCustomOption: boolean;
  questionFooter: boolean;
  questionMic: boolean;
  questionMicVisible: boolean;
}
