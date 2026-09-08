import 'dotenv/config'
import { WebSocket } from 'ws'
import { Awareness } from 'y-protocols/awareness.js'
import * as Y from 'yjs'

interface RoomWatcher {
    doc: Y.Doc
    awareness: Awareness
    ws: WebSocket
    flushing: boolean
}

const rooms = new Map<string, RoomWatcher>()

function startWatching(roomId: string): void {
    // will contain main room watching logic, including registering ws updates, as well as updating awareness for
    // a given room
}

// add logic to launch an HTTP server