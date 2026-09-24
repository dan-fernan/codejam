package com.codejam;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

@Service
public class RoomService {

    // ConcurrentHashMap allows multiple threads to access the same map,
    // while locking each bucket to ensure serialized updates to the same bucket
    // data, not simultaneous ones. Otherwise would have race conditions/lost updates
    private final RoomRepository roomRepository;
    private final Map<String, List<byte[]>> rooms = new ConcurrentHashMap<>(); 

    public RoomService(RoomRepository roomRepository) {
        this.roomRepository = roomRepository;
    }

    public String createRoom(String userId) {
        String id = UUID.randomUUID().toString();
        roomRepository.createRoom(id, userId); // throws on failure, nothing would get cached
        rooms.put(id, Collections.synchronizedList(new ArrayList<>()));
        return id;
    }

    public boolean roomExists(String id) {
        return rooms.containsKey(id);
    }
    public List<byte[]> getUpdates(String id) {
        return rooms.get(id);
    }

    public void appendUpdate(String id, byte[] update) {
        List<byte[]> updates = rooms.get(id);
        if (updates != null) {
            updates.add(update);
        }
    }
}
