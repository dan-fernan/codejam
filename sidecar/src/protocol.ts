import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync.js'
import * as awarenessProtocol from 'y-protocols/awareness.js'
import type { WebSocket, RawData } from 'ws'
import type { Room } from './rooms.js'

// Outer message types: the y-websocket convention, so WebsocketProvider speaks it natively
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

export function send(socket: WebSocket, message: Uint8Array): void {
  if (socket.readyState !== socket.OPEN) return
  socket.send(message, (err) => { if (err) socket.terminate() }) // failed send = dead socket
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)   // fragmented message
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data                                           // Buffer is already a Uint8Array
}

// "Here's what I have" - sent to every socket on join, so a client's offline edits
// (or everything, if Node lost the doc) come back in its SyncStep2 reply
export function syncStep1Message(room: Room): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, room.doc)
  return encoding.toUint8Array(encoder)
}

export function awarenessMessage(room: Room, clientIds: number[]): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, clientIds))
  return encoding.toUint8Array(encoder)
}

// Handles one incoming message. `socket` is passed as the origin, so the room-level
// listeners below know who sent a change and skip echoing it back.
export function handleMessage(room: Room, socket: WebSocket, data: RawData): void {
  const decoder = decoding.createDecoder(toUint8Array(data))
  const type = decoding.readVarUint(decoder)

  switch (type) {
    case MESSAGE_SYNC: {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      // SyncStep1 in → writes a SyncStep2 reply into encoder; SyncStep2/Update in → applies to room.doc
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, socket)
      if (encoding.length(encoder) > 1) send(socket, encoding.toUint8Array(encoder)) // only if there's a reply
      break
    }
    case MESSAGE_AWARENESS:
      awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), socket)
      break
    default:
      throw new Error(`unknown message type ${type}`)
  }
}

// Registered once per room, when it's created in getOrLoadRoom
export function attachRoomListeners(room: Room): void {
  room.doc.on('update', (update: Uint8Array, origin: unknown) => {
    room.dirty = true                                   // step 5 hooks the flush timer in here

    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    const message = encoding.toUint8Array(encoder)
    for (const peer of room.sockets.keys()) {
      if (peer !== origin) send(peer, message)          // don't echo back to the sender
    }
  })

  room.awareness.on('update', (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    // Track which client IDs each socket controls, so close can clean them up
    const ids = room.sockets.get(origin as WebSocket)
    if (ids) {
      added.forEach((id) => ids.add(id))
      removed.forEach((id) => ids.delete(id))
    }

    const message = awarenessMessage(room, added.concat(updated, removed))
    for (const peer of room.sockets.keys()) send(peer, message)
  })
}
