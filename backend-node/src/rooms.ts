import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness.js'
import type { WebSocket } from 'ws'
import { loadState, saveState } from './persistence.js'
import { attachRoomListeners } from './protocol.js'

const FLUSH_INTERVAL_MS = 60_000 // one write per min per room at most while edits are still happening
const EMPTY_GRACE_MS = 5_000 // a quick reconnect within this window doesn't trigger flush + eviction
const RETRY_MIN_MS = 2_000 // first retry after a failed flush; doubles each time
const RETRY_MAX_MS = 60_000

export interface Room {
  id: string
  doc: Y.Doc
  awareness: Awareness
  sockets: Map<WebSocket, Set<number>> // socket → awareness clientIDs it controls
  dirty: boolean
  flushTimer?: NodeJS.Timeout // pending periodic flush or retry
  emptyTimer?: NodeJS.Timeout // pending grace period before eviction
  flushing?: Promise<void> // PUT to Spring currently in flight
  retryDelay: number
}

export const rooms = new Map<string, Room>()
const loading = new Map<string, Promise<Room | null>>()

export function getOrLoadRoom(roomId: string): Promise<Room | null> {
  const cached = rooms.get(roomId)
  if (cached) return Promise.resolve(cached)

  const inFlight = loading.get(roomId)
  if (inFlight) return inFlight            // second joiner on a cold room waits for the same load

  const load = (async () => {
    const bytes = await loadState(roomId)
    if (bytes === null) return null        // unknown room: never allocate a doc

    const doc = new Y.Doc()
    if (bytes.length > 0) Y.applyUpdate(doc, bytes)
    const awareness = new Awareness(doc)
    awareness.setLocalState(null)          // the server has no cursor of its own

    const room: Room = { id: roomId, doc, awareness, sockets: new Map(), dirty: false, retryDelay: RETRY_MIN_MS }
    attachRoomListeners(room)
    doc.on('update', () => {
      room.dirty = true
      if (!room.flushTimer) scheduleFlush(room, FLUSH_INTERVAL_MS)
    })
    rooms.set(roomId, room)
    return room
  })().finally(() => loading.delete(roomId))

  loading.set(roomId, load)
  return load
}

// --flushing--
function scheduleFlush(room: Room, delayMs: number): void {
  clearTimeout(room.flushTimer)
  room.flushTimer = setTimeout(() => {
    room.flushTimer = undefined
    flush(room).catch(() => {})
  }, delayMs)
}

// writes room's current state to Spring.
function flush(room: Room): Promise<void> {
  if (room.flushing) return room.flushing
  if (!room.dirty) return Promise.resolve()

  room.dirty = false
  const bytes = Y.encodeStateAsUpdate(room.doc) //synchronous, so it's a consistent snapshot

  room.flushing = (async () => {
    try {
      const exists = await saveState(room.id, bytes)
      if (!exists) console.warn(`flush ${room.id}: room no longer exists in Spring, dropping state`)
      room.retryDelay = RETRY_MIN_MS
      console.log(`flushed ${room.id} (${bytes.length} bytes)`)
    } catch (err) {
      room.dirty = true
      console.error(`flush ${room.id} failed, retrying in ${room.retryDelay}ms:`, (err as Error).message)
      scheduleFlush(room, room.retryDelay)
      room.retryDelay = Math.min(room.retryDelay * 2, RETRY_MAX_MS)
      throw err
    } finally {
      room.flushing = undefined
    }
  })()
  return room.flushing
}

// keeps flushing until nothing is left, since edits can arrive while a PUT is in flight
async function flushUntilClean(room: Room): Promise<void> {
  while (room.dirty || room.flushing) await flush(room)
}

export function onRoomJoined(room: Room): void {
  clearTimeout(room.emptyTimer)
  room.emptyTimer = undefined
}

export function onRoomEmpty(room: Room): void {
  clearTimeout(room.emptyTimer)
  room.emptyTimer = setTimeout(() => {
    room.emptyTimer = undefined
    void evict(room)
  }, EMPTY_GRACE_MS)
}

async function evict(room: Room): Promise<void> {
  try {
    await flushUntilClean(room)
  } catch {
    if (room.sockets.size === 0) {
      // Spring is down: stay in memory and retry the eviction on the backoff schedule.
      // Cancel flush's own retry so there's only one retry path.
      clearTimeout(room.flushTimer)
      room.flushTimer = undefined
      clearTimeout(room.emptyTimer)
      room.emptyTimer = setTimeout(() => {
        room.emptyTimer = undefined
        void evict(room)
      }, room.retryDelay)
    }
    return
  }
  // the room stayed in rooms during the flush, so a joiner in that window got this same doc
  if (room.sockets.size > 0 || rooms.get(room.id) !== room) return

  clearTimeout(room.flushTimer)
  rooms.delete(room.id)
  room.awareness.destroy() // stops internal timeout timer
  room.doc.destroy()
  console.log(`evicted ${room.id}`)
}

// On shutdown: flush every room in parallel and wait for all of them
// so a normal stop (Ctrl+C, tsx restart, SIGTERM) doesn't lose any edits
export async function flushAll(): Promise<void> {
  const results = await Promise.allSettled(Array.from(rooms.values(), flushUntilClean))
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed > 0) console.error(`shutdown: ${failed} room(s) could not be flushed`)
}
