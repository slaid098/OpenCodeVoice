# 🎙️ OpenCodeVoice

![Cover](assets/cover.png)

Voice dictation for OpenCode 2 web. Whisper via Groq or any OpenAI-compatible STT endpoint, optional LLM cleanup, RU/EN interface.

**[Install the userscript](https://raw.githubusercontent.com/slaid098/OpenCodeVoice/dist/opencode-voice-dictation.user.js)**

## Features

- Microphone in the composer and in OpenCode question prompts.
- Built-in Whisper (Groq) preset — only an API key is needed.
- Custom URL for OpenAI, a proxy, or a self-hosted OpenAI-compatible endpoint.
- Optional LLM cleanup with an editable prompt.
- Auto-submit, automatic retries, and recovery of failed recordings after a reload.
- RU/EN interface, desktop hotkeys, mobile-friendly layout.

## Quick start

1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Install the script and open your OpenCode web UI.
3. In the settings panel, paste a Groq API key — or choose **Custom URL** and enter the endpoint and model.
4. Tap the microphone, speak, tap again.

A free Groq key is available at [console.groq.com/keys](https://console.groq.com/keys).

## Notes

- Requires OpenCode 2 (2.0.25+). Microphone access needs HTTPS or `localhost`.
- Audio goes to the configured STT provider; the transcript goes to the configured LLM provider. Nothing else leaves the browser.
- API keys are stored unencrypted in userscript storage.
- `401` means a key problem. `403` / `451` usually means the provider blocks your region — use **Custom URL** with a proxy or another STT service.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run build
```

## License

MIT
