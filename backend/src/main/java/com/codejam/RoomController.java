package com.codejam;

import com.codejam.RoomService.Room;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@CrossOrigin(origins="http://localhost:5173")
public class RoomController {
    private final RoomService service;

    private record UpdateRoomRequest(String code, String language){}

    public RoomController(RoomService service) {
        this.service = service;
    }

    @PostMapping("/rooms")
    public Room createRoom() {
        return service.createRoom();
    }

    @GetMapping("/rooms/{id}")
    public ResponseEntity<Room> getRoom(@PathVariable String id) {
        Room room = service.getRoom(id);
        if (room == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(room);
    }

    @PutMapping("/rooms/{id}")
    public ResponseEntity<Void> updateRoom(@PathVariable String id, @RequestBody 
        UpdateRoomRequest request) {
        
        if (service.getRoom(id) == null) {
            return ResponseEntity.notFound().build();
        }
        service.updateRoom(id, request.code(), request.language());
        return ResponseEntity.noContent().build();
    }
}
