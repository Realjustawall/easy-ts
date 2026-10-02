# Easy-ts

**Version 1.8.0** - A Chrome extension for Persian translation and dubbing of YouTube videos, YouTube Shorts, and local audio/video files.

## Features

- Dashboard with source previews, speaker timelines, translation editing, sentence timing and Voice IDs.
- Separate translation and speech generation progress, with estimated remaining time when available.
- Sequential dubbing playback, optional speaker voice mapping, and selective regeneration.
- Independent STT, translation, and TTS providers, including local speech servers.
- SRT subtitles, WAV audio, WebM video export, and separate background mixing.
- Live translation page, Persian interface, bundled Vazir fonts, dark/light themes, and responsive layouts.

## Installation

1. Download [Easy-ts-1.8.0.zip](Easy-ts-1.8.0.zip) and extract it, or clone this repository.
2. Open `chrome://extensions` in Chrome 116 or later.
3. Enable **Developer mode** and click **Load unpacked**.
4. Select the folder containing `manifest.json`.
5. Pin Easy-ts to the toolbar and open **Full settings** from its popup.

After updating files, click **Reload** on the extension, reload YouTube tabs, and reopen extension pages.

## Configure providers

Select a provider for each stage, enter its API key, configure its model and voice, and save settings before starting a job.

| Stage | Supported providers |
| --- | --- |
| Speech to text (STT) | Deepgram, Groq Whisper, ElevenLabs Scribe, Gemini audio understanding, OpenAI, local compatible server |
| Persian translation | Groq, Gemini, OpenAI |
| Text to speech (TTS) | Fish Audio, ElevenLabs, Gemini, OpenAI, local compatible server |
| Independent live sessions | Gemini Live, OpenAI Realtime, GPT-Live |

Fish Audio and ElevenLabs require a valid Voice ID. Gemini and OpenAI have default voices. Models, language support, quotas, and voice access depend on your provider account.

**Automatic TTS selection:** if enabled, when the selected cloud TTS provider has no key and exactly one other cloud TTS provider has a key, that provider is used. Your saved selection stays unchanged. With multiple keys, the explicit selection is retained. Local TTS must be selected explicitly. STT and translation remain independent and need their own configured providers.

Use **Generate voice sample** or **Test translation** to check saved settings. These requests may incur provider charges.

## Dub YouTube videos and Shorts

1. Open a YouTube video or Short.
2. Open the popup, or select the YouTube tab in the dashboard's expandable YouTube section.
3. Click **Start processing**.
4. Easy-ts attempts to obtain captions. Persian captions can be used directly; source captions are translated through your configured provider.
5. If captions are unavailable, playing tab audio is captured and transcribed with your configured STT provider.
6. Watch progress and play the available dubbed segments. For captured audio, seek back to hear segments already processed.

Click **Stop** to cancel processing and restore original audio. Moving to another Short stops the previous session; start processing again for the new Short.

Enable speaker detection in settings to transcribe YouTube audio instead of using captions. Speaker identities can change between capture windows. Capture is delayed, and progress describes received segments rather than the whole video.

## Process a local file

1. Choose an audio/video file in the dashboard or studio. Source files may be up to 200 MB; provider limits can be lower.
2. The file passes through STT, translation, and speech generation.
3. Select a sentence on the speaker timeline. Review its original text and edit its translation, timing, or voice.
4. Save changes and regenerate that sentence when its text or voice changes. Unsaved edits are preserved when another sentence is clicked.
5. Export SRT, or render and download WAV. Use the studio for background mixing and WebM video export.

For different speaker voices, enable **Automatic speaker voices** and enter one voice identifier per line in the chosen provider's speaker list. The first line maps to speaker 1. Unmapped speakers use the default; sentence overrides remain available.

WAV output is mono PCM at 24 kHz, with dialogue arranged sequentially. Long speech can extend the timeline beyond source timings. For video projects, render WAV first, then WebM. Video rendering runs in real time; keep the browser awake. The last frame can extend to preserve the audio tail.

Integrated exports support up to 20 minutes. Video recording has a 300 MB output limit. Background audio must be supplied separately; automatic music/dialogue separation is not implemented.

## Connect a running local speech model

The model must expose OpenAI-compatible audio HTTP endpoints. A model without these endpoints is insufficient; Ollama alone does not provide this speech API.

1. Select **Local model** for STT and/or TTS.
2. Enter each server's base URL, including its API prefix, such as `http://127.0.0.1:8000/v1` or `http://localhost:8880/v1`. STT and TTS can use different ports.
3. Enter model identifiers recognized by your server and a TTS voice identifier.
4. Enter an optional API key if the server requires Bearer authentication, then save.

This version supports HTTP/HTTPS loopback servers at `localhost` or `127.0.0.1`.

- TTS: `POST <base-url>/audio/speech`; JSON with `model`, `input`, `voice`, `response_format: "wav"`, and `speed`; returns audio bytes.
- STT: `POST <base-url>/audio/transcriptions`; multipart fields `file`, `model`, `response_format` (`verbose_json` or `diarized_json`), and optional `language`.
- STT must return `segments` with numeric `start` and `end` times in seconds and `text`. `speaker` is optional. Plain text without timestamps cannot drive the dubbing timeline.

Local speech processing does not make translation local: translation uses the separately selected provider.

## Live translation

Open the live page, choose microphone or shared-tab input, and start a session using the saved live provider/model. Grant media permission. Stop to release media resources. Live sessions are separate from file projects and do not produce project WAV/SRT exports.

## Privacy and limitations

Keys, source files, projects, and exports are stored in your browser profile. Keys are not encrypted. Audio and text are sent to providers selected for each stage. Settings export omits API keys; import preserves existing keys.

Speaker diarization does not separate mixed audio or guarantee every simultaneously spoken word. Gemini STT timestamps are estimates and need review. Sequential playback can lag the source, and speech stretching can introduce artifacts. Only one processing job runs at a time.

Provider accounts, network access, model support, and quotas affect results. Exact word alignment is not guaranteed.

## Development and validation

No build step is required. Runtime scripts, fonts, and icons are bundled locally.

```sh
node --test tests/content.test.cjs tests/background.test.cjs tests/engine.test.cjs tests/providers.test.cjs
python tests/verify-package.py
```

The suite contains 57 passing automated tests. Browser checks cover settings, dashboard, workbench editing, and live media lifecycle using mocked cloud responses. Real paid accounts and user-hosted models still need integration testing.

See [provider notes](PROVIDERS.md) for API details and [technical notes](TECHNICAL_NOTES.md) for implementation history. Supplementary notes currently include Persian text.

## License

[MIT](LICENSE). Tabler icons and Vazir fonts include their license files under `icons/ui/` and `fonts/`.