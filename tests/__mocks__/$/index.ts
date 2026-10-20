export interface MockXmlhttpResponse {
  status?: number;
  statusText?: string;
  responseText?: string;
  responseHeaders?: string;
  finalUrl?: string;
  error?: string;
  timeout?: boolean;
  delayMs?: number;
}

export type MockXmlhttpDetails = Record<string, unknown>;

type MockResponder = (
  details: MockXmlhttpDetails,
) => MockXmlhttpResponse | Promise<MockXmlhttpResponse>;

const mockStore: Record<string, unknown> = {};
const menuCommands = new Map<string, (event?: unknown) => void>();
const requests: MockXmlhttpDetails[] = [];
let responder: MockResponder = () => ({ status: 200, responseText: "{}" });

export const GM_getValue = (key: string, defaultValue: unknown): unknown => {
  return key in mockStore ? mockStore[key] : defaultValue;
};

export const GM_setValue = (key: string, value: unknown): void => {
  mockStore[key] = value;
};

export const GM_registerMenuCommand = (
  name: string,
  callback: (event?: unknown) => void,
): string => {
  menuCommands.set(name, callback);
  return name;
};

export const GM_info = {
  script: {
    name: "OpenCode Voice Dictation",
    version: "0.9.2",
    namespace: "https://github.com/slaid098/opencode-voice-dictation",
  },
  scriptHandler: "Tampermonkey",
  version: "5.0.0",
};

function callCallback(details: MockXmlhttpDetails, name: string, payload: unknown): void {
  const callback = details[name];
  if (typeof callback === "function") {
    callback(payload);
  }
}

export const GM_xmlhttpRequest = (details: MockXmlhttpDetails): { abort(): void } => {
  requests.push(details);
  let aborted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const handle = {
    abort(): void {
      if (aborted) {
        return;
      }
      aborted = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      callCallback(details, "onabort", {});
    },
  };

  void Promise.resolve()
    .then(() => responder(details))
    .then((response) => {
      if (aborted) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (aborted) {
          return;
        }
        if (response.timeout) {
          callCallback(details, "ontimeout", {});
          return;
        }
        if (response.error) {
          callCallback(details, "onerror", { error: response.error });
          return;
        }
        callCallback(details, "onload", {
          status: response.status ?? 200,
          statusText: response.statusText ?? "OK",
          responseText: response.responseText ?? "",
          responseHeaders: response.responseHeaders ?? "",
          finalUrl: response.finalUrl ?? (typeof details.url === "string" ? details.url : ""),
        });
      }, response.delayMs ?? 0);
    })
    .catch((error: unknown) => {
      if (aborted) {
        return;
      }
      callCallback(details, "onerror", { error });
    });

  return handle;
};

export const unsafeWindow = globalThis;

export const monkeyWindow = globalThis;

export const GM_addElement = (): void => {};

export function __setXmlhttpResponder(next: MockResponder): void {
  responder = next;
}

export function __getRequests(): MockXmlhttpDetails[] {
  return [...requests];
}

export function __getMenuCommands(): Map<string, (event?: unknown) => void> {
  return new Map(menuCommands);
}

export function __getMockStore(): Record<string, unknown> {
  return { ...mockStore };
}

export function __resetMockStore(): void {
  for (const key of Object.keys(mockStore)) {
    delete mockStore[key];
  }
  menuCommands.clear();
  requests.length = 0;
  responder = () => ({ status: 200, responseText: "{}" });
}
