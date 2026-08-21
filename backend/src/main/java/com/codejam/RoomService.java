package com.codejam;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

@Service
public class RoomService {
    public record Room(String id, String code, String language) {}

    // ConcurrentHashMap allows multiple threads to access the same map,
    // while locking each bucket to ensure serialized updates to the same bucket
    // data, not simultaneous ones. Otherwise would have race conditions/lost updates

    private final Map<String, Room> rooms = new ConcurrentHashMap<>(); 

    public Room createRoom() {
        String id = UUID.randomUUID().toString();
        Room room = new Room(id, "", "python");
        rooms.put(id, room);
        return room;
    }

    public Room getRoom(String id) {
        return rooms.get(id);
    }

    public void updateCode(String id, String code) {
        Room current = rooms.get(id);
        if (current != null) {
            rooms.put(id, new Room(id, code, current.language()));
        }
    }

    public void updateLanguage(String id, String language) {
        Room current = rooms.get(id);
        if (current != null) {
            rooms.put(id, new Room(id, current.code(), language));
        }
    }
}
