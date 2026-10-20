import { t } from "./i18n.js";

export interface RecordedAudio {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface AudioRecorder {
  start(): Promise<void>;
  stop(): Promise<RecordedAudio>;
  cancel(): void;
  isRecording(): boolean;
}

export class AudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioError";
  }
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function createAudioRecorder(): AudioRecorder {
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;
  let recording = false;
  let startedAt = 0;
  let mimeType = "";
  let discard = false;
  let recordingError: Error | null = null;
  let stopPromise: Promise<RecordedAudio> | null = null;

  const stopTracks = (): void => {
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
  };

  return {
    async start(): Promise<void> {
      if (recording) {
        throw new AudioError(t("audio.alreadyRecording"));
      }
      if (typeof window !== "undefined" && window.isSecureContext === false) {
        throw new AudioError(t("audio.secureContext"));
      }
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw new AudioError(t("audio.noRecordingSupport"));
      }
      if (typeof MediaRecorder === "undefined") {
        throw new AudioError(t("audio.noMediaRecorder"));
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (error) {
        throw mapGetUserMediaError(error);
      }

      chunks = [];
      discard = false;
      recordingError = null;
      stopPromise = null;
      mediaRecorder = null;
      mimeType = pickMimeType();
      try {
        mediaRecorder = mimeType
          ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 })
          : new MediaRecorder(stream, { audioBitsPerSecond: 64_000 });
      } catch {
        mediaRecorder = new MediaRecorder(stream);
        mimeType = mediaRecorder.mimeType || mimeType;
      }

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      mediaRecorder.onerror = () => {
        recordingError = new AudioError(t("audio.recordingError"));
      };

      startedAt = Date.now();
      mediaRecorder.start();
      recording = true;
    },

    stop(): Promise<RecordedAudio> {
      if (stopPromise) {
        return stopPromise;
      }
      if (!mediaRecorder || !recording) {
        return Promise.reject(new AudioError(t("audio.notStarted")));
      }

      const recorder = mediaRecorder;
      const capturedMime = mimeType || recorder.mimeType || "audio/webm";
      const durationMs = Math.max(0, Date.now() - startedAt);
      stopPromise = new Promise<RecordedAudio>((resolve, reject) => {
        let settled = false;
        const finish = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          recording = false;
          stopTracks();
          const blob = new Blob(chunks, { type: capturedMime });
          if (discard) {
            chunks = [];
            stopPromise = null;
            reject(new AudioError(t("audio.cancelled")));
            return;
          }
          if (blob.size === 0) {
            stopPromise = null;
            reject(recordingError ?? new AudioError(t("audio.empty")));
            return;
          }
          resolve({ blob, mimeType: capturedMime, durationMs });
        };

        const timeout = setTimeout(() => {
          // Preserve whatever was recorded instead of losing the whole take.
          finish();
        }, 3_000);

        recorder.onstop = finish;
        recorder.onerror = () => {
          recordingError = new AudioError(t("audio.recordingError"));
          finish();
        };

        try {
          if (recorder.state !== "inactive") {
            recorder.stop();
          } else {
            finish();
          }
        } catch {
          finish();
        }
      });
      return stopPromise;
    },

    cancel(): void {
      discard = true;
      stopTracks();
      recording = false;
      chunks = [];
      stopPromise = null;
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        try {
          mediaRecorder.onstop = null;
          mediaRecorder.stop();
        } catch {
          // ignore
        }
      }
      mediaRecorder = null;
    },

    isRecording(): boolean {
      return recording;
    },
  };
}

export function mapGetUserMediaError(error: unknown): AudioError {
  if (error instanceof Error) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return new AudioError(t("audio.denied"));
      case "NotFoundError":
      case "DevicesNotFoundError":
        return new AudioError(t("audio.notFound"));
      case "NotReadableError":
      case "TrackStartError":
        return new AudioError(t("audio.busy"));
      case "OverconstrainedError":
        return new AudioError(t("audio.constraints"));
      default:
        return new AudioError(t("audio.accessFailed", { message: error.message }));
    }
  }
  return new AudioError(t("audio.accessFailedUnknown"));
}
