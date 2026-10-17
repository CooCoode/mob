# macOS streaming voice input (composer)

**Status:** local working-tree implementation (not yet released). macOS only.
**Goal:** speak a prompt into the chat composer with streaming partials, and optionally early-dispatch to mobd before Apple’s final transcript arrives.

## Flow

```text
Mic button (click toggle / hold-to-talk)
        │
        ▼
Tauri `voice_start` → ObjC SFSpeechRecognizer + AVAudioEngine
        │
        ├─ event voice-partial  → composer text (streaming)
        ├─ event voice-silence  → maybe early POST /tasks
        ├─ event voice-final    → confirm / correct
        └─ event voice-error    → surface in tooltip + Settings log
```

1. **Partials** overwrite the composer while listening (unless a provisional task is already in flight).
2. **“Said enough”** is detected by:
   - native silence (~1.1s low RMS / no new speech), and
   - a TS fallback timer (`VOICE_DEFAULTS.silenceMs`), plus
   - semantic boundary heuristics (`looksComplete` / `shouldEarlyDispatch` in `src/lib/voiceHeuristics.ts`).
3. **Early dispatch:** when silence fires and the text looks complete with enough confidence, the client `POST /tasks` immediately and tracks `provisionalTaskId` + text.
4. **Final correction:** when `voice-final` arrives:
   - if normalized text ≈ provisional → keep the task (no-op);
   - if **materially different** → `POST /tasks/{id}/cancel`, wait until the turn is terminal, then submit the final text;
   - if nothing was early-sent → submit the final (or on mic stop, flush if the draft is usable).

## Confidence fallbacks

`SFTranscriptionSegment.confidence` is not always populated. Native code averages available segment scores; when unknown it reports `~0.55` for partials and `1.0` for finals. Early dispatch still proceeds when the utterance ends with `。！？.!?` even if confidence is low.

## Permissions

Bundled via `src-tauri/Info.plist` (merged) and `entitlements.plist`:

| Key | Purpose |
| --- | --- |
| `NSMicrophoneUsageDescription` | Mic access |
| `NSSpeechRecognitionUsageDescription` | Speech framework |
| `com.apple.security.device.audio-input` | Hardened-runtime mic |

First use triggers macOS TCC prompts. Grant **Microphone** and **Speech Recognition** for `mob`.

## Native surface

| Piece | Path |
| --- | --- |
| ObjC recognizer | `src-tauri/native/voice_macos.m` (+ `.h`) |
| Rust commands / events | `src-tauri/src/voice.rs` |
| Build (darwin only) | `src-tauri/build.rs` compiles `.m`, links Speech + AVFoundation |
| Non-macOS | `voice_supported` → `false`; start returns an error; mic button disabled |

Events: `voice-partial`, `voice-final`, `voice-silence`, `voice-error`.
Commands: `voice_supported`, `voice_start`, `voice_stop` (capability `allow-voice`).

## Frontend

| Piece | Path |
| --- | --- |
| Heuristics | `src/lib/voiceHeuristics.ts` |
| Invoke / listen | `src/lib/voice.ts` |
| Hook | `src/hooks/useVoiceInput.ts` |
| Mic control | `src/components/composer/Composer.tsx` |

## How to test (on a Mac)

1. `cd` to this repo, `npm install`, `npm run tauri dev`.
2. Pair a machine / open a session as usual.
3. Click the mic next to Send — allow Mic + Speech if prompted.
4. Speak a short command (e.g. “Open Safari and go to example.com”). Partials should stream into the composer.
5. Pause ~1s: if the heuristic fires, a task should appear **before** the final transcript settles.
6. Intentionally say something that Apple revises a lot; confirm a cancel + resubmit when the final drifts.
7. Hold the mic to talk, release to stop; click again to toggle.
8. On Linux/Windows builds the mic stays disabled (`voice_supported === false`).

## Still verify on a real Mac

- [ ] `cargo build` / `tauri dev` with Speech + AVFoundation linking
- [ ] TCC prompts and Settings → Privacy entries for `mob`
- [ ] Partial streaming latency and Chinese / English dictation quality
- [ ] Early-dispatch race when mobd queue already has a running turn (`canSend` false)
- [ ] Cancel + resubmit when final drifts (timing vs SSE)
- [ ] Hardened runtime / notarized build still gets mic input
- [ ] Behavior when Speech authorization is denied

## Non-goals (this pass)

- iOS / Android STT
- Continuous always-on listening
- Sending audio to a cloud ASR (Apple may still use network dictation unless on-device is forced later)
