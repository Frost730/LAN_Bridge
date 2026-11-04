# LANBridge Project Rules & Engineering Guidelines

## 1. Security & File System Invariants
- **Path Traversal Protection**: Every file retrieval, download, and deletion operation MUST strictly verify that the target path resolves inside `settings.RECEIVED_DIR` or `settings.TEMP_DIR` using `is_safe_subpath()` or `Path.is_relative_to()`. Never join unverified user input directly to filesystem paths.
- **Archive Generation & OOM Prevention**: When creating multi-file zip archives for download, stream them to a temporary file on disk in `settings.TEMP_DIR`. Never accumulate archive bytes in an in-memory `io.BytesIO()` buffer, as this crashes cloud containers with Out-Of-Memory (OOM) errors. Always sanitize internal archive relative paths (`arcname`) to prevent Zip Slip.
- **Process & Power Controls**: Administrative actions (`/api/shutdown`, `/api/restart`, and server-level setting modifications) MUST be restricted strictly to local loopback requests (`127.0.0.1`, `::1`). Never allow remote network peers to execute process shutdown or restart.
- **WebSocket Security**: 
  - Validate the `Origin` header on `/ws` to prevent Cross-Site WebSocket Hijacking (CSWSH).
  - Enforce a strict whitelist on client-originated WebSocket message types (`webrtc_offer`, `webrtc_answer`, `webrtc_ice_candidate`, `chat_message`, `join_room`, `leave_room`). Never allow clients to forward server-authoritative event types (such as `pair_approved`, `transfer_accepted`, `transfer_completed`).

## 2. Frontend & DOM File Handling
- **File Input Lifecycle**: In React file/folder picker components, NEVER clear `input.value = ''` synchronously inside an `onChange` handler. In Chromium on Windows, clearing the input value immediately invalidates the underlying OS file descriptors in the `FileList`, causing subsequent hashing or streaming reads to return empty/corrupted data. Clear `input.value = ''` only in the `onClick` handler prior to opening the dialog.
- **Notification Aggregation**: Never emit system notifications for individual files within a multi-file or folder transfer. Always aggregate notifications to fire exactly once per transfer completion with a consistent notification `tag` and debouncing.

## 3. Asynchronous Tasks & Testing Guidelines
- **Background Tasks in FastAPI**: Any background task scheduled with `BackgroundTasks` must complete quickly. Never introduce static long sleeps (`asyncio.sleep()`) in background tasks without checking configuration settings (e.g. `settings.AUTO_DELETE_DELAY_SECONDS == 0`), because ASGI test clients (`httpx.ASGITransport`) await all background tasks before completing the HTTP response.
- **SQLite Concurrency**: Use `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL` to prevent concurrency deadlocks between streaming chunk writers and WebSocket state readers.
