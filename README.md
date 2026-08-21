# CodeJam

  A real-time collaborative code editor built for technical interview prep (TIP) — two people can
  share a room, edit code together, and run it in a sandboxed environment.

  ## Stack

  **Backend** — Java 21, Spring Boot 4.1.0, Docker (sandboxed code execution)
  **Frontend** — React 19, TypeScript, Vite, React Router

  ## How it's put together

  - **Execution** — `DockerRunner` runs submitted code inside a locked-down, resource-capped
  container (`--network=none`, memory/CPU/PID limits, output truncation) and returns stdout/stderr.
  `ExecutionService` wraps it with a bounded thread pool; `ExecutionController` exposes it at `POST
  /execute`.
  - **Rooms** — `RoomService` holds an in-memory map of rooms (`id`, `code`, `language`).
  `RoomController` exposes `POST /rooms` (create) and `GET /rooms/{id}` (fetch current state — used
  on page load/refresh, and by anyone joining a room after it's already in progress).
  - **Live sync** — `RoomWebSocketHandler` handles connections at `/ws/rooms/{roomId}`, relaying
  code/language changes between everyone connected to the same room, and keeping `RoomService`'s
  stored copy current so late joiners don't start from a blank room.

  ## Running locally

  ## Status / next up

  Live sync currently broadcasts the full code string on every change — correct for now, but doesn't
  merge concurrent edits from two people typing at once. Next step is replacing that with Yjs
  (CRDT-based sync) alongside a Monaco editor, so simultaneous edits merge correctly instead of one
  overwriting the other.

  See `CHANGELOG.mdx` for detailed history of what's been added/changed.