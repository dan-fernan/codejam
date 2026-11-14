package com.codejam;

import com.codejam.DockerRunner.ExecutionResult;
import org.springframework.stereotype.Service;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class ExecutionService {
    private static final Duration EXECUTION_TIMEOUT = Duration.ofSeconds(10);

    private final DockerRunner runner;
    private final ExecutorService executor = Executors.newFixedThreadPool(10);

    public ExecutionService(DockerRunner runner) {
        this.runner = runner;
    }

    public CompletableFuture<ExecutionResult> execute(String code, String language) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                return runner.run(code, language, EXECUTION_TIMEOUT);
            } catch (Exception e) {
                return new ExecutionResult("", e.getMessage(), -1, false);
            }
        }, executor);
    }
}