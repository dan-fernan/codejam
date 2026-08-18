package com.codejam;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import org.springframework.stereotype.Component; 

@Component
public class DockerRunner {
	// type `record` is shorthand for creating an immutable class declaration
	private record LanguageConfig(String image, String fileName, List<String> command) {}

	private static final Map<String, LanguageConfig> LANGUAGES = Map.ofEntries(
		Map.entry("python", new LanguageConfig("python:3.12-slim", "main.py", List.of("python", "/code/main.py"))),
		Map.entry("javascript", new LanguageConfig("node:20-slim", "main.js", List.of("node", "/code/main.js")))
	);

	private static final int MAX_CODE_LENGTH = 10_000;  // chars, checked before writing to disk
	private static final int MAX_OUTPUT_CHARS = 2_000;  // chars, checked per stream (stdout/stderr independently)

	public record ExecutionResult(String stdout, String stderr, int exitCode, boolean timedOut) {
		public boolean success() {
			return exitCode == 0 && !timedOut;
		}
	}

	public ExecutionResult run(String code, String language, Duration timeout) throws Exception {
		LanguageConfig config = LANGUAGES.get(language);
		if (config == null) {
			throw new IllegalArgumentException("Unsupported language: " + language);
		}
		if (code.length() > MAX_CODE_LENGTH) {
			throw new IllegalArgumentException("Code exceeds max length of " + MAX_CODE_LENGTH + " characters");
		}

		Path tempDir = Files.createTempDirectory("codejam-");
		try {
			Files.writeString(tempDir.resolve(config.fileName()), code);

			List<String> command = new ArrayList<>(List.of(
				"docker", "run", "--rm",
				"--network=none",
				"--memory=128m", "--memory-swap=128m",
				"--cpus=0.5",
				"--pids-limit=64", // limits pids to mitigate fork bombing
				"-v", tempDir + ":/code:ro", // creates a bind between hostDir and container dir, needs to be read-only so that malicious code ran in the container cannot be projected back to the hostDir
				config.image()
			));
			command.addAll(config.command());

			ProcessBuilder pb = new ProcessBuilder(command);
			Process process = pb.start();

			ExecutorService executor = Executors.newFixedThreadPool(2);

			// type `Future` holds the result of async work
			Future<String> stdoutFuture = executor.submit(() -> readStream(process.getInputStream()));
			Future<String> stderrFuture = executor.submit(() -> readStream(process.getErrorStream()));

			boolean finished = process.waitFor(timeout.toSeconds(), TimeUnit.SECONDS);

			if (!finished) {
				process.destroyForcibly();
				executor.shutdownNow();
				System.out.println("Process timed out and was killed.");
				return new ExecutionResult("", "", -1, true);
			}

			String stdout = stdoutFuture.get(2, TimeUnit.SECONDS);
			String stderr = stderrFuture.get(2, TimeUnit.SECONDS);
			executor.shutdown();

			return new ExecutionResult(stdout, stderr, process.exitValue(), false);
		} finally {
			deleteTempDir(tempDir, config.fileName);
		}
	}

	private static void deleteTempDir(Path dir, String fileName) throws IOException{
		Files.delete(dir.resolve(fileName));
		Files.delete(dir);
	}

	private static String readStream(InputStream is) throws IOException {
		BufferedReader reader = new BufferedReader(new InputStreamReader(is));
		StringBuilder sb = new StringBuilder();
		boolean truncated = false;
		String line;

		// keep draining even after truncating, otherwise the process can block on a full pipe buffer
		while((line = reader.readLine()) != null) {
			if (!truncated && sb.length() + line.length() > MAX_OUTPUT_CHARS) {
				sb.append("\n... [output truncated]");
				truncated = true;
			} else if (!truncated) {
				sb.append(line).append("\n");
			}
		}
		return sb.toString();
	}

	public static void main(String[] args) throws Exception {
		DockerRunner runner = new DockerRunner();

		String[][] cases = {
			{"valid", "print('hello from codejam')"},
			{"broken", "print('unterminated"},
			{"infinite loop", "while True:\n    pass"},
			{"fork bomb", "import os\nwhile True:\n    os.fork()"}
		};

		for (String[] testCase : cases) {
			System.out.println("=== " + testCase[0] + " ===");
			ExecutionResult result = runner.run(testCase[1], "python", Duration.ofSeconds(10));
			System.out.println("Exit Code: " + result.exitCode());
			System.out.println("Timed out: " + result.timedOut());
			System.out.println("stdout:\n" + result.stdout());
			System.out.println("stderr:\n" + result.stderr());
			System.out.println();
		}
	}
}