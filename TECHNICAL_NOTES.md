# 1.8.0 Shorts, Gemini and local speech providers

Shorts URLs are accepted in background and popup/dashboard tab selection. Content and caption bridge select the active Shorts player and reject stale caption responses. Shorts navigation restores original audio and stops the previous dubbing session. Single-key TTS resolution preserves saved choices and uses provider-specific voice maps; local mode is explicit. OpenAI-compatible local speech endpoints have independent loopback URLs and models, optional Bearer auth and timed STT output validation.

Gemini 3.8 TTS now uses the documented generateContent speech metadata and voice schema; 2.5 PCM conversion remains supported. Large audio uses resumable Files upload, readiness polling and best-effort cleanup even on errors. Live handshake has a 30-second timeout and reports WebSocket close reasons. 57 Node tests plus settings/dashboard browser checks pass with mocked provider responses. Real provider accounts and user model servers were not tested.

# 1.7.0 integrated editing desk

Dashboard now uses the existing guarded project APIs for segment edits, selected voice regeneration, WAV rendering and restoration. Source previews use cached real files; timeline tracks group source timings by speaker. Draft edits prevent accidental selection or project replacement. Revision changes invalidate stale audio and exports. Media URLs are revoked and competing players pause each other. The editor supports responsive layouts and local Vazir typography.

Validation: 50 Node tests pass, plus browser checks for timeline selection, original/translation display, draft preservation, revision saves, stale audio blocking and mobile overflow. Cloud responses in browser tests are mocked; paid provider accounts were not tested.

# 1.6.0 dashboard redesign

The new dashboard reuses the existing dubbing controller with explicit YouTube tab selection. Shared workspace navigation, CSS tokens, local Vazir fonts and locally bundled MIT Tabler icons cover dashboard, studio, live and settings. Dark/light appearance persists locally; mobile navigation moves to the bottom. Dashboard overview reads IndexedDB jobs and runtime cache/provider responses; it does not create demo metrics. Project links restore the selected job through the existing guarded restore route. Settings search filters visibility without changing or discarding values.

Validation: 50 engine/provider/content/background tests pass. Browser checks cover dashboard tab selection, overview data, project links, themes and responsive layout; popup progress and autosave; studio edits, pagination, bulk voice and background controls; settings save/import/export, voice opt-in and search; live PCM capture, cancellation and media cleanup. Browser cloud responses are mocked, with real local IndexedDB and media behavior.

# 1.5.2 content lifecycle fix

50 Node tests pass. New coverage exercises synchronous and asynchronous invalidated extension contexts, missing runtime IDs, original audio restoration, timer/listener removal, re-injection, pending RPC cancellation, and recovery after a transient connection error. The former content.js:317 call used .catch only after sendMessage returned, leaving synchronous context errors uncaught. All content messages now use an async wrapper with lifecycle cleanup.

# 1.5.1 regression verification

- 45 Node tests pass, including sequential playback, pause/seek, cancellation, rolling caption deduplication, speaker mapping opt-in, offscreen creation coalescing and status routing recursion.
- Browser settings checks pass, including saving two ElevenLabs voice IDs and the opt-in switch.
- Real browser WAV/WebM export with overlapping input turns and a four-second background track passes. The three-second source video keeps its last image through the four-second audio tail. Cancellation publishes no stale video.
- Stored audio duration reserves enough timeline space at the configured speed limit. Source timings remain intact in the editor. Serialized timelines can lag the source. YouTube pause/end still pauses dubbing; studio exports preserve the complete tail.
- Old mixed exports require rebuilding (timelineVersion 2). Cloud calls use mocks; real paid provider accounts were not tested.

Previous release notes follow.

# Easy-ts 1.5.0 — Technical notes

## 1.5.0 provider routing and live sessions

provider-config.js defines independent STT/translation/TTS selection and provider-specific speaker voice maps. provider-engine.js dispatches legacy engine entry points to ElevenLabs Scribe/TTS, Gemini structured translation/audio understanding/Interactions TTS or legacy generateContent TTS, and OpenAI transcription/chat translation/speech. Cache fingerprints include non-secret provider settings (version 5). New projects bind ttsProvider; regeneration rejects a provider mismatch to preserve cached voice consistency. The auto STT route retains Deepgram for files or speaker-mode capture and Groq for ordinary capture.

settings.html uses shared schema-generated accessible fields, validation, manual saving, local font assets, sample synthesis/translation, and key-free import/export. background imports that schema to validate API setting patches too. Host access is limited to the existing providers plus ElevenLabs, Google Generative Language and OpenAI.

live.html runs its own session lifecycle. Gemini capture uses a local AudioWorklet and PCM16 at 16kHz; output is decoded and scheduled with a bounded queue. Interruption clears scheduled audio. OpenAI connects via WebRTC; trusted extension background performs ephemeral Realtime setup or GPT-Live SDP exchange. These privileged handlers accept only the extension live/settings page respectively. No automatic network retries are made for session creation. User stop, permission rejection, late capture resolution, disconnection and startup timeout release tracks and audio. GPT-Live close waits up to 15 seconds for server finalization and otherwise marks usage unconfirmed. Live sessions are independent of studio exports.

Current validation: 39 Node tests including a complete mixed ElevenLabs STT → Gemini translation → OpenAI TTS pipeline without legacy keys; settings browser import/export/save/bounds; real AudioWorklet capture with a mock Gemini socket, stop and late permission cancellation; synthetic actual WAV/WebM export and video cancellation. Real cloud accounts and extension-specific end-to-end execution remain unverified. Official docs and limitations are in PROVIDERS.md. Older sections below describe their original release tests.

## Ownership and cancellation

The background owns one active YouTube tab and stores its ID in chrome.storage.session so service-worker suspension does not discard ownership. Other tabs cannot change playback state. Start restores the previous page audio and stops the previous engine before launching a new job. SPA navigation and tab close stop the owning job.

The offscreen engine increments runEpoch on stop/replacement. Translation callbacks, IndexedDB completions, synthesis workers and capture callbacks verify ownership before updating runtime state. Provider requests carry abort signals and 90-second timeouts; retry sleeps are abortable. Status fanout belongs to the background because offscreen documents support chrome.runtime, not chrome.tabs.

## Progress

engine-core.js computes separate translated and ready counts. For a finite caption job, overallPercent = round((translated + ready) / (2 * total) * 100). Failed audio remains incomplete. ETA measures newly synthesized segments, excluding cached ready files. Live capture has no overall completion percentage; its stage percentages describe only received segments.

## Playback

Each ready timeline segment owns an Audio lane. All overlapping ready segments play together, with volume divided by sqrt(active lane count). The next two segments preload. Seek removes obsolete lanes; serial/job/map checks prevent old metadata loads from playing after stop or replacement. Pitch preservation is enabled. Audio position follows video position using a bounded duration-fit rate, multiplied by YouTube playbackRate. A short line finishes naturally rather than looping.

## Capture and speakers

Every recorder callback closes over its recorder, chunks, epoch and timestamp window. Seek or playback-rate changes discard the discontinuous window; pause retains the completed portion. The queue is limited to three windows. Queue saturation temporarily suspends capture and can leave gaps if video playback continues.

Optional Deepgram Nova-3 prerecorded requests use diarize_model=latest, utterances=true and mip_opt_out=true. Word timing determines splits and speaker boundaries. A missing diarize_info is an error rather than a fabricated speaker result. Speaker identities are scoped to a recording window; no cross-window voice matching or source separation is implemented. Concurrent playback preserves overlaps present in provider output.

## Cache and translation

Cache fingerprints include version, video, voice, model, bitrate, style and configured speaker voices. Ready cache metadata is reconciled with actual audio records. Missing files and failed synthesis are retried. Translated text retains sourceText. Translation batches are bounded to 48 items / 11k source characters, with two simultaneous requests. Every returned ID must be expected, unique and nonempty; omitted translations fail validation. Cached successful audio is reused.

## Verification

13 Node regression tests use isolated engine contexts and mocked provider/storage/audio surfaces. Browser checks exercise the popup with mocked Chrome messaging. Real credentials, provider quality, Chrome tabCapture permissions and end-to-end YouTube playback still need a real account/video test. Browser screenshots are in output/playwright; they contain simulated status data.

## 1.3.0 studio

## 1.4.0 background mixing and speaker assignment

Optional background files share the existing sources store. Project revisions cover background key/gain/duck changes and bulk speaker voice assignments; both invalidate mixed exports. Background changes preserve all sentence audio, while voice assignment invalidates only changed sentences for the exact scoped speaker. No source separation model is included. Background input starts at zero, is folded to mono at 24kHz, and extends WAV duration (20-minute cap); video remains bounded by source picture duration. Merged dialogue intervals control a 25ms attack / 250ms release gain envelope.

Validation: 25 Node regressions, studio controls exercised with mocked messaging at desktop/mobile sizes, and actual browser audio/video render with synthetic 440Hz speech plus a 220Hz independent background. WAV retained the fourth-second background tail; WebM retained the source three-second duration. Video cancellation left no stale export. Real provider quality and extension-specific offscreen behavior remain unverified.

studio.html is a full-page extension UI. Files move through shared IndexedDB (studio-db.js, database version 2); Chrome messages carry keys and plain project metadata, never large media Blobs. Stores are jobs, audio, sources and exports. Settings remain in the existing settings stores. Cached input keys hash file contents; file job keys also include voice/model/style/glossary/pronunciation settings. API keys are not persisted in jobs.

studio-engine.js runs inside the offscreen document after offscreen.js. One complete Deepgram request gives speaker labels a file-wide scope. Partial translation batches persist their text so rerunning the same file/settings can resume. Broader context is bounded to 18k characters and sampled across long projects; each batch includes adjacent source turns. This is diarization, not source separation.

Project edit/restore mutations are serialized. Revision checks reject stale editor pages. Spoken text or voice changes invalidate only affected cached audio, while all edits invalidate mixed audio/video exports. Timing-only changes retain sentence audio. Selected regeneration performs a preflight synthesis before opening a bounded concurrent pool. Dirty UI rows prevent export and are not overwritten by refresh or pagination.

Audio export decodes each sentence at 24kHz, fits long lines with granular overlap/add and local correlation, mixes their timeline positions, and writes normalized mono PCM WAV. Short lines preserve silence. It is an approximate pitch-preserving algorithm, not a production-quality speech stretch guarantee; real speech needs listening tests. A pure sine regression checks duration and approximate pitch. Export is capped at 20 minutes to bound browser memory.

Video export reads the uploaded video through captureStream and replaces its audio with the rendered WAV routed to a MediaStreamDestination. MediaRecorder runs in real time with VP9/Opus or a supported fallback. Original audio never enters the output stream. Duration metadata is inserted into the recorder's EBML Info using Blob slices and a bounded header read. The maximum recording size is 300 MiB. Abort closes recording/context/tracks and epoch checks prevent late output publication.

Verification: 22 Node regressions; popup and studio browser checks with mocked Chrome/provider messages; actual browser WAV + WebM exports from a three-second synthetic MP4; ffprobe confirmed codecs, dimensions and duration; decoded output audio had the dubbed 440Hz rather than original 660Hz tone. Browser video cancellation was also checked. Actual cloud-provider responses, human speech quality and extension-offscreen/YouTube end-to-end behavior still need real-account testing. Tests and synthetic fixtures are excluded from the install ZIP.
