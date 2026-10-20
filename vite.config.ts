import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  plugins: [
    monkey({
      entry: "src/index.ts",
      userscript: {
        name: "OpenCode Voice Dictation",
        namespace: "https://github.com/slaid098/opencode-voice-dictation",
        version: "2.0.0",
        description:
          "Voice dictation for OpenCode 2 web: Whisper STT, LLM cleanup, auto-submit, recovery — works on PC and mobile",
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
        icon: "https://git.slaid098.dev/slaid098/opencode-voice-dictation/raw/branch/main/assets/icon.png",
        updateURL:
          "https://git.slaid098.dev/slaid098/opencode-voice-dictation/raw/branch/dist/opencode-voice-dictation.meta.js",
        downloadURL:
          "https://git.slaid098.dev/slaid098/opencode-voice-dictation/raw/branch/dist/opencode-voice-dictation.user.js",
      },
      build: {
        fileName: "opencode-voice-dictation.user.js",
        metaFileName: true,
      },
    }),
  ],
});
