# TD: Node real-time layer + Spring persistence

Notes from the architecture discussion. Nothing here is implemented yet.

## Proposal

Two co-equal services, not a backend-plus-helper: Node is the real-time layer, Spring is the
persistence layer. All permanent writes are orchestrated by Spring alone, Node never touches
Postgres directly.

- **Node** (real-time layer, code lives in `sidecar/` — the directory name predates this framing and
  is just where the code happens to sit) owns Yjs docs, WebSocket connections, awareness, and a
  write-back cache.
- **Spring** (persistence layer, `backend/`) owns persistence (cache-miss loads, writes,
  room/participant records) and sandboxed code execution (`DockerRunner`, `/execute`). It is the
  sole Postgres client in the system.

### Why

- Yjs is native to JS. A server-side `Y.Doc` can compact with `Y.encodeStateAsUpdate`, which fixes the
  unbounded update-list growth noted in the README. Java can't do this because it never decodes the bytes.
- Rooms are currently an in-memory map in `RoomService` and vanish on restart. Node's map becomes a cache,
  and a miss is a defined event that goes to Spring.
- Resume-wise it's a stronger story: write-back cache, cache-miss loading, deduped concurrent loads,
  flush on disconnect/shutdown, snapshot compaction, and an explicit durability tradeoff. The split is
  justified (Yjs is native to JS), and Java still owns the execution sandbox and persistence.

## Decisions to make

1. ~~Who writes to Postgres?~~ **Decided: Spring is the only DB client.** Two writers exist in code
   today (Spring's `RoomRepository` and `sidecar/src/db.ts`'s `writeRoomBytes`), but `db.ts` is dead
   going forward, Node calls Spring over HTTP instead (e.g. `GET /rooms/{id}/state` on a miss,
   `PUT /rooms/{id}/state` on flush). One extra hop, negligible because flushes are debounced.
2. **Room entry shape.** The `RoomWatcher` stub in `sidecar/src/index.ts` has one `ws` per room, which
   looks like the sidecar as a client of Spring's relay. Node is now the server, so use something like
   `{ doc, awareness, sockets: Set<WebSocket>, dirty, flushTimer }`.
3. **Sync protocol.** Replace the raw-update relay (one-byte tag, `GET /rooms/{id}` bootstrap) with the
   standard y-protocols handshake. Late joiners get state over the socket.

## Approach: `y-protocols` directly

Chosen over a ready-made server (Hocuspocus, y-websocket server utils) or a fully raw protocol. The room
lifecycle is the interesting part to own; `y-protocols` handles the protocol encoding.
(Note: y-websocket's server code moved out of the main package in v3, to `@y/websocket-server`. Check the
current layout if reconsidering it as a fallback.)

### What `y-protocols` (v1.0.7, already a sidecar dependency) provides

- **`sync`**: message types `0` SyncStep1 (state vector), `1` SyncStep2 (missing updates), `2` Update.
  `readSyncMessage(decoder, encoder, doc, origin)` applies the message and writes any reply.
- **`awareness`**: `Awareness`, `encodeAwarenessUpdate`, `applyAwarenessUpdate`,
  `removeAwarenessStates`. Entries time out after 30s of silence.
- **`auth`**: a permission-denied message. Probably unneeded; reject bad joins before the handshake.

### What we write ourselves

- **Framing**: an outer tag per message (sync = 0, awareness = 1, the y-websocket convention), then route to
  `readSyncMessage` or `applyAwarenessUpdate`. Encoder/decoder helpers come from `lib0` (transitive dep of
  `yjs`; add it to `package.json` explicitly if imported).
- **Broadcasting**: `doc.on('update')` and `awareness.on('update')` forward to other sockets; use `origin` to
  skip echoing to the sender.
- **Room lifecycle**: room map, load on miss, flush, eviction, heartbeats, rejecting unknown rooms.

### Per-connection flow

1. Socket opens; look up or load the room's `Y.Doc`.
2. Send SyncStep1 from the server, then current awareness states.
3. On each message, read the outer tag: sync -> `readSyncMessage` (send any reply); awareness ->
   `applyAwarenessUpdate`.
4. Doc `update` handler broadcasts to other sockets and marks the room dirty for the flush timer.
5. On close, `removeAwarenessStates` for that socket's client IDs; flush and evict if the room is empty.

## Details that will bite if skipped

- **Concurrent cache misses**: two clients joining a cold room both call Spring and build separate docs.
  Cache the in-flight load promise per room in the map.
- **Unknown rooms**: if Spring returns 404, close the socket. Don't allocate a doc.
- **Write-back triggers**: debounce timer, last socket leaves, and `SIGTERM`. A hard crash loses up to one
  debounce interval of edits; acceptable for interview prep. Evict idle docs after flushing to keep the
  cache small.
- **Awareness cleanup**: track client IDs per socket and remove them on close, or ghost cursors linger.
- **Heartbeats**: ping/pong to drop half-open connections; otherwise the last socket never leaves and the
  room is never flushed or evicted.
- **Single authoritative process per room**: scaling out would need sticky routing by room ID. Not a
  concern now; worth a README line.
- **Backpressure**: ignore for two-person editing.

## Changes by component

**Node (real-time layer, `sidecar/`)**
- WebSocket server with the room lifecycle above; HTTP client to Spring for load/flush.
- Remove `db.ts` and the `pg` dependency — Spring is the only DB client, Node has no business talking
  to Postgres at all.

**Backend (Spring)**
- Keep: `DockerRunner`, `ExecutionService`, `ExecutionController`, `RoomRepository`, room/participant
  records, `POST /rooms`.
- Add: state load/store endpoints for a room's snapshot bytes; `GET /rooms/{id}` may become an existence
  check.
- Remove: `RoomWebSocketHandler`, `WebSocketConfig`, and the in-memory update list in `RoomService`.
- CORS and the `userId` cookie config need to work for both origins.
- Startup note: `.env` is not loaded by Spring. Either `set -a && source .env && set +a` before
  `./mvnw spring-boot:run`, or add `spring.config.import=optional:file:.env[.properties]` to
  `application.properties`.

**Frontend**
- Switch to a provider that speaks the same protocol (`y-websocket`'s `WebsocketProvider` uses the same tag
  convention). This replaces the hand-written socket code and one-byte tag on the client, and removes the
  REST bootstrap + client-side `Y.mergeUpdates`.
- Frontend talks to two origins: Node for the socket, Spring for REST.

## Code execution: Docker now, Lambda considered

`DockerRunner`/`ExecutionService` run `docker run` directly against Spring's own host, which needs privileged
Docker access — this is what ruled out Fargate/App Runner/Lightsail Containers for Java specifically (confirmed:
Fargate forbids privileged mode and socket mounting). Moving execution to AWS Lambda (one container-image function
per language, invoked via the AWS SDK) removes that requirement entirely: Java stops needing a privileged Docker
host, which reopens those cheaper serverless-container platforms for Java's own hosting.

Trade-offs to keep in mind if this gets built:
- No clean equivalent for `--network=none` (needs a VPC with no outbound route) or `--pids-limit` (Lambda's
  per-invocation resource ceiling is the closest analog, not a process-count cap).
- Cold starts on container-image Lambdas are real; mitigations (smaller images, provisioned concurrency) have
  their own cost.
- `ExecutionService`'s fixed thread pool of 10 stops protecting local host resources and becomes just an
  HTTP-call throttle against Lambda instead.

Not scheduled — a direction for when `DockerRunner` needs revisiting, not a current task.

## Real-time layer scaling: y-redis / y/hub considered and deferred

Both let multiple Node processes share room state via Redis Streams (no single process owns a room, no sticky
routing needed) — a direct answer to the "single authoritative process per room" item above. Deferred because:
- Solves horizontal scaling of the real-time layer, which CodeJam doesn't need at TIP/hobby scale — one Node
  process holds this fine.
- `y-redis` (the original, from the Yjs author) persists to Postgres; `y/hub` (the newer, actively-documented
  successor) persists to S3 or Postgres and is beta, dual-licensed AGPL/proprietary — either reopens "who writes
  to Postgres" or adds a licensing question.
- Free tiers exist (Upstash: 256MB/500K commands/mo), so cost isn't the blocker here — need is.

Worth revisiting only if CodeJam actually needs multiple real-time server processes.

## Open items

- Pick the flush debounce interval and idle-eviction timeout.
- Update the README (stack, architecture, "Persistence" next-up item) once implemented.