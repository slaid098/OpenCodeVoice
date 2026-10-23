import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

const REPOSITORY = "slaid098/OpenCodeVoice";
const NAMESPACE = "https://github.com/slaid098/opencode-voice-dictation";
const DESCRIPTION =
  "Voice dictation for OpenCode 2 web: Whisper (Groq) or a custom OpenAI-compatible STT endpoint, optional LLM cleanup, RU/EN UI, auto-submit, recovery — works on PC and mobile";

const dev = process.env.OCVD_CHANNEL === "dev";
const version = process.env.OCVD_VERSION || "0.9.10";
const rawBase = `https://raw.githubusercontent.com/${REPOSITORY}/${dev ? "dev-dist" : "dist"}`;

export default defineConfig({
  plugins: [
    monkey({
      entry: "src/index.ts",
      userscript: {
        name: dev ? "OpenCode Voice Dictation (dev)" : "OpenCode Voice Dictation",
        namespace: dev ? `${NAMESPACE}/dev` : NAMESPACE,
        version,
        description: dev ? `${DESCRIPTION} (dev build)` : DESCRIPTION,
        author: "slaid098",
        match: ["*://*/*"],
        noframes: true,
        grant: [
          "GM_xmlhttpRequest",
          "GM_getValue",
          "GM_setValue",
          "GM_registerMenuCommand",
          "GM_info",
        ],
        connect: ["*"],
        "run-at": "document-idle",
        icon: `https://raw.githubusercontent.com/${REPOSITORY}/main/assets/icon.png`,
        updateURL: `${rawBase}/opencode-voice-dictation.meta.js`,
        downloadURL: `${rawBase}/opencode-voice-dictation.user.js`,
      },
      build: {
        fileName: "opencode-voice-dictation.user.js",
        metaFileName: true,
      },
    }),
  ],
});
