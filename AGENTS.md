<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep temporary communication switches and media subscription/capture rules in `src/lib/media-policy.ts`, shared by client and server, so disabled features cannot publish or execute through hidden controls.
- LiveKit subscribes to cameras in the room and screen tracks only for the selected watcher; screen playback is guarded separately to prevent race-condition audio leaks.
- Enumerate devices without opening hardware; acquire cameras only on explicit action and clean up failed publication/connection attempts.
- Desktop-only features (PiP window mode, global hotkeys, updater) go through Rust commands in `src-tauri/src/desktop.rs` called via `src/lib/desktop.ts`; the remote-loaded web UI must no-op when `window.__TAURI__` is absent.
- Updates compare the CI run number baked in as `PAJE_BUILD` against `latest.json` published with each Release, so no manual version bumps are needed.
