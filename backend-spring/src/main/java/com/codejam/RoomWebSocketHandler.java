package com.codejam;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.BinaryWebSocketHandler;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RoomWebSocketHandler extends BinaryWebSocketHandler{
    
    private final RoomService roomService;
    private final Map<String, Set<WebSocketSession>> roomSessions = new ConcurrentHashMap<>();

    public RoomWebSocketHandler(RoomService roomService) {
        this.roomService = roomService;
    }

    private String extractRoomId(WebSocketSession session) {
        String path = session.getUri().getPath();
        return path.substring(path.lastIndexOf('/') + 1);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String roomId = extractRoomId(session);
        roomSessions.computeIfAbsent(roomId, id -> ConcurrentHashMap.newKeySet()).add(session);
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) throws Exception {
        String roomId = extractRoomId(session);

        ByteBuffer payload = message.getPayload();
        byte[] raw = new byte[payload.remaining()];
        payload.get(raw);
        // creates a new array to hold the payload content, better than relying on
        // ambiguous Spring output

        if (raw.length > 0 && raw[0] == 0) {
            // tag 0 = a real Y.Doc update - strip the leading tag byte before
            // persisting, so GET /rooms/{id} keeps returning plain Yjs update bytes
            byte[] update = Arrays.copyOfRange(raw, 1, raw.length);
            roomService.appendUpdate(roomId, update);
        }
        // tag 1 = awareness/cursor update - relayed below, never persisted
        // (ephemeral cursor state has no business in the room's permanent history)

        for (WebSocketSession peer : roomSessions.getOrDefault(roomId, Set.of())) {
            if (peer.isOpen() && !peer.getId().equals(session.getId())) {
                try {
                    peer.sendMessage(new BinaryMessage(raw));
                    /* 
                        must create a new BinaryMessage for each session. Without individual Binary messages,
                        each session reads from the same object, which is read through pointers. The first
                        recipient will receive the entire update, but succeeding ones will receive empty messages,
                        as the payload would be effectively exhausted by the first recipient.
                    */
                } catch (Exception ignored) {}
            }   
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Set<WebSocketSession> sessions = roomSessions.get(extractRoomId(session));
        if (sessions != null) sessions.remove(session);
    }
}
