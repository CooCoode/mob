# Live desktop over WebRTC: desktop app plan

Status: **draft**, branch `feat/webrtc-stream`. Design and protocol: [mobd desktop streaming](https://github.com/xrdavies/mobd/blob/feat/webrtc-stream/docs/desktop-streaming.md).

## Why

The live view uses svnc over mobd's `/vnc` relay and receives the office Mac's full 4K framebuffer.
mobd now streams H.264 at the size the client shows, over WebRTC (Pion) with a WebSocket fallback.
VNC is removed; mobd and the apps are released together.

## What changes here

| Area | Today | After |
| --- | --- | --- |
| Live view | `src/lib/vnc.ts` + `@xrdavies/svnc`, `/vnc?ticket=` | `src/lib/stream.ts`: `RTCPeerConnection` in the webview, `<video>`; signaling via `fetch` with the Bearer header |
| Control | svnc input | data channels `input` / `pointer` / `control` (mobd design, "Data channels") |
| Fallback | none | `/stream/ws` with the single-use `wsTicket`, decoded with WebCodecs `VideoDecoder` into a canvas |
| Snapshot | fixed 1280 px every 30 s | panel width × devicePixelRatio, quality ≈ 65, every 3–5 s while the panel is open, `ETag` |
| Settings | Desktop sign-in (macOS user + password in Keychain) | removed; per-machine **Live view quality: Auto / High / Low** |
| Store | v4 | v5 drops `vncUsername`, deletes `<id>.vncPassword` from the Keychain, adds `liveQuality` |

Files mainly touched: `src/lib/vnc.ts` (replaced), `src/components/preview/PreviewPanel.tsx`,
`src/App.tsx`, `src/components/settings/SettingsDialog.tsx`, `src/store/app.ts`, `src/store/migrate.ts`,
`src/api/client.ts`, `package.json` (drop `@xrdavies/svnc`).

## Steps

| Step | Content | Verified by |
| --- | --- | --- |
| D1 | Snapshot size and refresh as above | panel in the running app |
| D2 | View-only WebRTC live view; "Update mobd" when `/health` lacks `stream`. **Checkpoint:** H.264 playback in Tauri's WKWebView | office Mac over LAN and Tailscale |
| D3 | Control mode: mouse, keyboard, scroll, modifiers over data channels; Esc/View behaviour unchanged | manual input checks |
| D4 | Quality setting; readout of kB/s, fps, resolution, transport | throttled link |
| D5 | WebSocket fallback, raced against WebRTC (keep WebRTC if connected within ~3 s) | Funnel address |
| D6 | Remove svnc, ticket code, Desktop sign-in; store v5 migration | `npm test`, typecheck |
| D7 | Tests: signaling, message encoding, transport choice, migration | `make test` |

Starts after mobd M7. Merges with the other repos at release.
