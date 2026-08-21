package com.codejam;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RoomWebSocketHandler extends TextWebSocketHandler{
    
    private final RoomService roomService;
    private final ObjectMapper objectMapper;
    private final Map<String, Set<WebSocketSession>> roomSessions = new ConcurrentHashMap<>();

    private record WsMessage(String type, String value) {}

    public RoomWebSocketHandler(RoomService roomService, ObjectMapper objectMapper) {
        this.roomService = roomService;
        this.objectMapper = objectMapper;
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
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String roomId = extractRoomId(session);

        WsMessage wsMessage = objectMapper.readValue(message.getPayload(), WsMessage.class);
        switch(wsMessage.type()) {
            case "code" -> roomService.updateCode(roomId, wsMessage.value());
            case "language" -> roomService.updateLanguage(roomId, wsMessage.value());
        }

        for (WebSocketSession peer : roomSessions.getOrDefault(roomId, Set.of())) {
            if (peer.isOpen() && !peer.getId().equals(session.getId())) {
                peer.sendMessage(message);
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Set<WebSocketSession> sessions = roomSessions.get(extractRoomId(session));
        if (sessions != null) sessions.remove(session);
    }
}
