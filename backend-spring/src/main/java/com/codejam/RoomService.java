package com.codejam;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.Optional;

import com.oblac.nomen.Nomen;
import org.springframework.stereotype.Service;

import com.codejam.RoomRepository.RecentRoom;

@Service
public class RoomService {
    private final RoomRepository roomRepository;

    public RoomService(RoomRepository roomRepository) {
        this.roomRepository = roomRepository;
    }

    public String createRoom(String userId, String alias) {
        String id = UUID.randomUUID().toString();
        String resolvedAlias = (alias == null || alias.isBlank())
            ? Nomen.est().adjective().animal().withSeparator("-").get()
            : alias;
        roomRepository.createRoom(id, userId, resolvedAlias); // throws on failure, nothing would get cached
        return id;
    }

    public boolean joinRoom(String roomId, String userId) {
        return roomRepository.joinRoom(roomId, userId);
    }

    public List<RecentRoom> getRecentRooms(String userId) {
        if (userId == null) return List.of();
        return roomRepository.getRecentRooms(userId);
    }

    public boolean roomExists(String id) {
        return roomRepository.roomExists(id);
    }

    public Optional<byte[]> loadState(String roomId) {
        return roomRepository.loadState(roomId);
    }

    public boolean saveState(String roomId, byte[] bytes) {
        return roomRepository.saveState(roomId, bytes);
    }
}
