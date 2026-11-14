package com.codejam;

import com.codejam.DockerRunner.ExecutionResult;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import java.util.concurrent.CompletableFuture;

@RestController
@CrossOrigin(origins = "http://localhost:5173")
public class ExecutionController {

    private record ExecuteRequest(String code, String language) {}
    private final ExecutionService service;

    public ExecutionController(ExecutionService service) {
        this.service = service;
    }

    @PostMapping("/execute")
    public CompletableFuture<ExecutionResult> execute(@RequestBody ExecuteRequest request) {
        return service.execute(request.code(), request.language());
    }
}