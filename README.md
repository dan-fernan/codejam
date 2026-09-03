# CodeJam

  A real-time collaborative code editor built for technical interview prep (TIP) — two people can
  share a room, edit code together, and run it in a sandboxed environment.

  ## Stack

  **Backend** — Java 21, Spring Boot 4.1.0, Docker (sandboxed code execution)
  **Frontend** — React 19, TypeScript, Vite, React Router, Monaco Editor, Yjs (CRDT sync)

  ## How it's put together

  - **Execution** — `DockerRunner` runs submitted code inside a locked-down, resource-capped
  container (`--network=none`, memory/CPU/PID limits, output truncation) and returns stdout/stderr.
  `ExecutionService` wraps it with a bounded thread pool; `ExecutionController` exposes it at `POST
  /execute`.
  - **Rooms** — `RoomService` holds an in-memory map of rooms, each backed by an append-only list of
  raw Yjs update byte arrays. Java never decodes or interprets these bytes — it's purely a
  content-agnostic store-and-relay. `RoomController` exposes `POST /rooms` (create) and `GET
  /rooms/{id}` (fetch the room's full update history — used to bootstrap anyone loading or joining a
  room, including late joiners).
  - **Live sync** — `RoomWebSocketHandler` (`BinaryWebSocketHandler`) handles connections at
  `/ws/rooms/{roomId}`, appending each incoming update to `RoomService` and relaying it to every other
  peer in the room as raw bytes, live.
  - **Collaborative editing** — the frontend runs a `Y.Doc` per room. On mount, it fetches the room's
  stored update history, merges it client-side (`Y.mergeUpdates`) and applies it once before the
  editor ever mounts, avoiding replay flicker. `y-monaco`'s `MonacoBinding` then wires the resulting
  `Y.Text` directly to a Monaco editor instance, translating Monaco's structured edit events into CRDT
  operations (and back) automatically — so concurrent edits from multiple people merge correctly
  instead of one overwriting the other. Language selection rides the same sync path via a `Y.Map`.
  Local vs. remote changes are distinguished with Yjs's transaction `origin` tagging, so applying an
  incoming update never gets echoed back out over the socket.
  - **Presence** — awareness/cursor updates share the same WebSocket as doc updates, distinguished by
  a one-byte tag Java reads to decide whether to persist (doc updates only — cursor state is never
  written to `RoomService`). Each client's `y-protocols` `Awareness` broadcasts a `{name, color}`
  state; `MonacoBinding`'s 4th constructor argument renders remote cursors/selections, colored per
  client from a small fixed palette keyed off their Yjs `clientID`.
  - **UI** — the whole frontend takes its palette, fonts, and animation keyframes from a single
  `theme.ts`, sourced from the `CodejamJarFlat` mascot component so the mascot and the rest of the app
  never drift apart. The mascot itself doubles as a live status indicator in the room header, its mood
  driven by real state (idle, typing, running, run result) rather than a generic spinner.

  ## Running locally

  ## Status / next up

  Yjs/Monaco integration is in place — concurrent edits merge correctly instead of last-write-wins.
  Live cursor/selection presence and a shared mascot-driven visual identity are in place too. What's
  left, roughly in order:
  - **Bounding storage growth** — each room's update list currently grows forever. Next step is
  periodic checkpointing: have a connected client periodically replace the stored list with a single
  compacted `Y.encodeStateAsUpdate` snapshot of its own doc.
  - **Persistence** — rooms are in-memory only and disappear on backend restart. Planned: a MongoDB
  layer, plus a browser cookie tracking a user's recently created rooms.

  See `CHANGELOG.mdx` for detailed history of what's been added/changed.