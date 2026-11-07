import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness.js'
import type { WebSocket } from 'ws'
import { loadState } from './persistence.js'
import { attachRoomListeners } from './protocol.js'

export interface Room {
  doc: Y.Doc
  awareness: Awareness
  sockets: Map<WebSocket, Set<number>> // socket → awareness clientIDs it controls (used in step 3)
  dirty: boolean
  flushTimer?: NodeJS.Timeout
  emptyTimer?: NodeJS.Timeout
  flushing?: Promise<void>
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

    const room: Room = { doc, awareness, sockets: new Map(), dirty: false }
    attachRoomListeners(room)
    rooms.set(roomId, room)
    return room
  })().finally(() => loading.delete(roomId))

  loading.set(roomId, load)
  return load
}
