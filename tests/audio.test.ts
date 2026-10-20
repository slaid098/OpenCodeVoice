import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioError,
  createAudioRecorder,
  formatTime,
  mapGetUserMediaError,
  pickMimeType,
} from "../src/audio.js";

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supported = new Set<string>(["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]);
  static isTypeSupported = vi.fn((type: string) => FakeMediaRecorder.supported.has(type));
  static failWithOptions = false;
  static autoStop = true;

  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  stream: MediaStream;
  options: unknown;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  stopCalls = 0;

  constructor(stream: MediaStream, options?: unknown) {
    if (FakeMediaRecorder.failWithOptions && options) {
      throw new Error("unsupported options");
    }
    const candidate = options as { mimeType?: string } | undefined;
    if (candidate?.mimeType) {
      this.mimeType = candidate.mimeType;
    }
    this.stream = stream;
    this.options = options;
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.stopCalls += 1;
    this.state = "inactive";
    if (FakeMediaRecorder.autoStop) {
      const handler = this.onstop;
      setTimeout(() => handler?.(), 0);
    }
  }

  emitData(size = 8, type = "audio/webm"): void {
    this.ondataavailable?.({
      data: new Blob(["x".repeat(size)], { type }),
    } as BlobEvent);
  }

  emitError(): void {
    this.onerror?.();
  }
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const originalSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");

function stubMediaDevices(getUserMedia: (...args: unknown[]) => Promise<MediaStream>): void {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function fakeStream(stopTrack = vi.fn()): MediaStream {
  return {
    getTracks: () => [{ stop: stopTrack }],
  } as unknown as MediaStream;
}

function stubRecorder(): void {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.failWithOptions = false;
  FakeMediaRecorder.autoStop = true;
  FakeMediaRecorder.supported = new Set(["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
}

function lastRecorder(): FakeMediaRecorder {
  const recorder = FakeMediaRecorder.instances.at(-1);
  if (!recorder) {
    throw new Error("MediaRecorder was not created");
  }
  return recorder;
}

beforeEach(() => {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeMediaRecorder.instances = [];
  if (originalMediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
  if (originalSecureContext) {
    Object.defineProperty(window, "isSecureContext", originalSecureContext);
  } else {
    Reflect.deleteProperty(window, "isSecureContext");
  }
});

describe("formatTime", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(5)).toBe("00:05");
    expect(formatTime(59)).toBe("00:59");
    expect(formatTime(60)).toBe("01:00");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(125)).toBe("02:05");
    expect(formatTime(600)).toBe("10:00");
  });

  it("does not clamp large values", () => {
    expect(formatTime(3_599)).toBe("59:59");
    expect(formatTime(3_600)).toBe("60:00");
  });
});

describe("pickMimeType", () => {
  it("prefers opus webm and falls back in order", () => {
    stubRecorder();
    expect(pickMimeType()).toBe("audio/webm;codecs=opus");

    FakeMediaRecorder.supported = new Set(["audio/webm", "audio/mp4"]);
    expect(pickMimeType()).toBe("audio/webm");

    FakeMediaRecorder.supported = new Set(["audio/mp4"]);
    expect(pickMimeType()).toBe("audio/mp4");

    FakeMediaRecorder.supported = new Set();
    expect(pickMimeType()).toBe("");
  });

  it("returns an empty string without MediaRecorder support", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickMimeType()).toBe("");

    vi.stubGlobal("MediaRecorder", class {});
    expect(pickMimeType()).toBe("");
  });
});

describe("mapGetUserMediaError", () => {
  it.each([
    ["NotAllowedError", "Доступ к микрофону запрещён"],
    ["SecurityError", "Доступ к микрофону запрещён"],
    ["NotFoundError", "Микрофон не найден"],
    ["DevicesNotFoundError", "Микрофон не найден"],
    ["NotReadableError", "Микрофон занят другим приложением"],
    ["TrackStartError", "Микрофон занят другим приложением"],
    ["OverconstrainedError", "Микрофон не поддерживает нужные параметры"],
  ])("maps %s", (name, message) => {
    const error = new Error("raw");
    error.name = name;
    expect(mapGetUserMediaError(error)).toBeInstanceOf(AudioError);
    expect(mapGetUserMediaError(error).message).toContain(message);
  });

  it("keeps the message of unknown errors", () => {
    expect(mapGetUserMediaError(new Error("boom")).message).toContain("boom");
    expect(mapGetUserMediaError("nope").message).toContain("Не удалось получить доступ");
  });
});

describe("createAudioRecorder start", () => {
  it("requests audio, starts MediaRecorder and reports recording", async () => {
    stubRecorder();
    const getUserMedia = vi.fn(async () => fakeStream());
    stubMediaDevices(getUserMedia);

    const recorder = createAudioRecorder();
    await recorder.start();

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const media = lastRecorder();
    expect(media.state).toBe("recording");
    expect(media.options).toEqual({
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 64_000,
    });
    expect(recorder.isRecording()).toBe(true);
  });

  it("rejects a second start while recording", async () => {
    stubRecorder();
    stubMediaDevices(async () => fakeStream());
    const recorder = createAudioRecorder();
    await recorder.start();
    await expect(recorder.start()).rejects.toThrow("Запись уже идёт.");
  });

  it("requires a secure context", async () => {
    stubRecorder();
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    await expect(createAudioRecorder().start()).rejects.toThrow(/HTTPS/);
  });

  it("requires getUserMedia", async () => {
    stubRecorder();
    Reflect.deleteProperty(navigator, "mediaDevices");
    await expect(createAudioRecorder().start()).rejects.toThrow(/не поддерживает запись/);
  });

  it("requires MediaRecorder", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    stubMediaDevices(async () => fakeStream());
    await expect(createAudioRecorder().start()).rejects.toThrow(/MediaRecorder/);
  });

  it("maps getUserMedia rejections", async () => {
    stubRecorder();
    const error = new Error("denied");
    error.name = "NotAllowedError";
    stubMediaDevices(async () => {
      throw error;
    });
    await expect(createAudioRecorder().start()).rejects.toThrow(/запрещён/);
  });

  it("falls back when the recorder rejects the mime options", async () => {
    stubRecorder();
    FakeMediaRecorder.failWithOptions = true;
    stubMediaDevices(async () => fakeStream());

    const recorder = createAudioRecorder();
    await recorder.start();
    const media = lastRecorder();
    expect(media.options).toBeUndefined();
    expect(media.mimeType).toBe("audio/webm");

    media.emitData();
    const audio = await recorder.stop();
    expect(audio.mimeType).toBe("audio/webm");
  });

  it("uses MediaRecorder without options when no mime type is supported", async () => {
    stubRecorder();
    FakeMediaRecorder.supported = new Set();
    stubMediaDevices(async () => fakeStream());
    const recorder = createAudioRecorder();
    await recorder.start();
    expect(lastRecorder().options).toEqual({ audioBitsPerSecond: 64_000 });
  });
});

describe("createAudioRecorder stop", () => {
  it("returns the recorded blob, mime type and duration", async () => {
    stubRecorder();
    const stopTrack = vi.fn();
    stubMediaDevices(async () => fakeStream(stopTrack));
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(3_250);

    const recorder = createAudioRecorder();
    await recorder.start();
    const media = lastRecorder();
    media.emitData(16);
    media.emitData(0);
    media.emitData(4);

    const audio = await recorder.stop();
    expect(audio.blob).toBeInstanceOf(Blob);
    expect(audio.blob.size).toBe(20);
    expect(audio.mimeType).toBe("audio/webm;codecs=opus");
    expect(audio.blob.type).toBe("audio/webm;codecs=opus");
    expect(audio.durationMs).toBe(2_250);
    expect(recorder.isRecording()).toBe(false);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(media.stopCalls).toBe(1);
  });

  it("returns the same promise when stopped twice", async () => {
    stubRecorder();
    stubMediaDevices(async () => fakeStream());
    const recorder = createAudioRecorder();
    await recorder.start();
    lastRecorder().emitData();

    const first = recorder.stop();
    const second = recorder.stop();
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ durationMs: 0 });
  });

  it("rejects when recording was not started", async () => {
    stubRecorder();
    await expect(createAudioRecorder().stop()).rejects.toThrow("Запись не начата.");
  });

  it("rejects an empty recording", async () => {
    stubRecorder();
    stubMediaDevices(async () => fakeStream());
    const recorder = createAudioRecorder();
    await recorder.start();
    await expect(recorder.stop()).rejects.toThrow(/Запись пустая/);
  });

  it("rejects with a recorder error when no data arrived", async () => {
    stubRecorder();
    stubMediaDevices(async () => fakeStream());
    const recorder = createAudioRecorder();
    await recorder.start();
    lastRecorder().emitError();
    await expect(recorder.stop()).rejects.toThrow("Ошибка записи с микрофона.");
  });

  it("preserves partial audio after a MediaRecorder error", async () => {
    stubRecorder();
    stubMediaDevices(async () => fakeStream());
    const recorder = createAudioRecorder();
    await recorder.start();
    const media = lastRecorder();
    media.emitData(10);
    media.emitError();
    const audio = await recorder.stop();
    expect(audio.blob.size).toBe(10);
  });

  it("finishes when the recorder is already inactive", async () => {
    stubRecorder();
    stubMediaDevices(async () => fakeStream());
    const recorder = createAudioRecorder();
    await recorder.start();
    const media = lastRecorder();
    media.emitData();
    media.state = "inactive";
    await expect(recorder.stop()).resolves.toMatchObject({ mimeType: "audio/webm;codecs=opus" });
  });

  it("finishes when stop throws", async () => {
    stubRecorder();
    stubMediaDevices(async () => fakeStream());
    const recorder = createAudioRecorder();
    await recorder.start();
    const media = lastRecorder();
    media.emitData();
    media.stop = () => {
      throw new Error("cannot stop");
    };
    await expect(recorder.stop()).resolves.toBeInstanceOf(Object);
  });

  it("resolves through the 3 second timeout when onstop never fires", async () => {
    vi.useFakeTimers();
    stubRecorder();
    FakeMediaRecorder.autoStop = false;
    stubMediaDevices(async () => fakeStream());
    const recorder = createAudioRecorder();
    await recorder.start();
    lastRecorder().emitData(12);

    const promise = recorder.stop();
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(promise).resolves.toMatchObject({ durationMs: 0 });
  });
});

describe("createAudioRecorder cancel", () => {
  it("stops tracks, discards data and resets state", async () => {
    stubRecorder();
    const stopTrack = vi.fn();
    stubMediaDevices(async () => fakeStream(stopTrack));
    const recorder = createAudioRecorder();
    await recorder.start();
    const media = lastRecorder();
    media.emitData(32);

    recorder.cancel();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(recorder.isRecording()).toBe(false);
    expect(media.onstop).toBeNull();
    await expect(recorder.stop()).rejects.toThrow("Запись не начата.");
  });

  it("is safe without an active recording", () => {
    stubRecorder();
    const recorder = createAudioRecorder();
    expect(() => recorder.cancel()).not.toThrow();
    expect(recorder.isRecording()).toBe(false);
  });

  it("ignores a recorder that already stopped", async () => {
    stubRecorder();
    stubMediaDevices(async () => fakeStream());
    const recorder = createAudioRecorder();
    await recorder.start();
    const media = lastRecorder();
    media.state = "inactive";
    expect(() => recorder.cancel()).not.toThrow();
    expect(media.stopCalls).toBe(0);
  });
});
