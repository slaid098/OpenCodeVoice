import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  plugins: [
    monkey({
      entry: "src/index.ts",
      userscript: {
        name: "OpenCode Voice Dictation",
        namespace: "https://github.com/slaid098/opencode-voice-dictation",
        version: "0.9.0",
        description:
          "Voice dictation for OpenCode 2 web: Whisper (Groq) or a custom OpenAI-compatible STT endpoint, optional LLM cleanup, RU/EN UI, auto-submit, recovery — works on PC and mobile",
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
        icon: "https://raw.githubusercontent.com/slaid098/OpenCodeVoice/main/assets/icon.png",
        updateURL:
          "https://raw.githubusercontent.com/slaid098/OpenCodeVoice/dist/opencode-voice-dictation.meta.js",
        downloadURL:
          "https://raw.githubusercontent.com/slaid098/OpenCodeVoice/dist/opencode-voice-dictation.user.js",
      },
      build: {
        fileName: "opencode-voice-dictation.user.js",
        metaFileName: true,
      },
    }),
  ],
});
