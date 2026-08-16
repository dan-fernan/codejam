package com.example.demo;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.List;
import java.util.concurrent.*;

public class DockerRunner {
	public static void main(String[] args) {
		String hostDir = System.getProperty("user.dir") + "/test-code";

		List<String> command = List.of(
			"docker", "run", "--rm",
			"--network=none",
			"--memory=128m", "--memory-swap=128m",
			"--cpus=0.5",
			"--pids-limit=64",
			"-v", hostDir + ":/code",
			"python:3.12-slim",
			"python", "/code/test.py"
		);

		ProcessBuilder pb = new ProcessBuilder(command);
		Process process = pb.start();

		ExecutorService executor = Executors.newFixedThreadPool(2);

		Future<String> stdoutFuture = executor.submit(() -> readStream(process.getInputStream()));
		Future<String> stderrFuture = executor.submit(() -> readStream(process.getErrorStream()));

		boolean finished = process.waitFor(10, TimeUnit.SECONDS);

		if (!finished) {
			process.destroyForcibly();
			executor.shutDownNow();
			System.out.println("Process timed out and was killed.");
			return;
		}

		String stdout = stdoutFuture.get(2, TimeUnit.SECONDS);
		String stderr = stderrFuture.get(2, TimeUnit.SECONDS);
		executor.shutdown();

		System.out.println("Exit Code: " + process.exitValue());
		System.out.println("stdout:\n" + stdout);
		System.out.println("stderr:\n" + stderr);	
	}

	private static String readStream(InputStream is) throws IOException {
		BufferedReader reader = new BufferedReader(new InputStreamReader(is));
		StringBuilder sb = new StringBuilder();
		String line;

		while((line = reader.readLine()) != null) {
			sb.append(line).append("\n");
		}
		return sb.toString();
	}
}
