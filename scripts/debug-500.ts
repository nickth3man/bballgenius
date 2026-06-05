/**
 * Debug script: captures the full SSR 500 error from the web dev server.
 *
 * Usage: bun run scripts/debug-500.ts
 * Output: written to temp/debug-500.log
 */

const LOG_FILE = new URL('../temp/debug-500.log', import.meta.url).pathname;

async function main() {
  // Kill any existing process on port 3000
  const kill = Bun.spawn(['bun', 'x', 'kill-port', '3000'], {
    cwd: import.meta.dir,
  });
  await kill.exited;

  // Spawn web dev server in background, pipe all output
  const proc = Bun.spawn(['bun', 'run', 'web'], {
    cwd: import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  let output = '';

  // Read stdout
  const stdoutPromise = (async () => {
    for await (const chunk of proc.stdout) {
      output += new TextDecoder().decode(chunk);
    }
  })();

  // Read stderr
  const stderrPromise = (async () => {
    for await (const chunk of proc.stderr) {
      output += new TextDecoder().decode(chunk);
    }
  })();

  // Wait for server to start (poll port)
  console.error('Waiting for server to start...');
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://localhost:3000/', {
        signal: AbortSignal.timeout(3000),
      });
      console.error(`Server responded with ${res.status}`);
      ready = true;
      break;
    } catch {
      await Bun.sleep(1000);
    }
  }

  if (!ready) {
    output += '\n\n[SERVER NEVER BECAME READY]\n';
  } else {
    // Wait a beat for any async errors to flush to stderr
    await Bun.sleep(3000);
  }

  // Kill the server
  proc.kill('SIGTERM');
  await Bun.sleep(2000);

  // Wait for output streams to close
  await Promise.race([Promise.all([stdoutPromise, stderrPromise]), Bun.sleep(5000)]);

  // Write to log file
  await Bun.write(LOG_FILE, output);
  console.error(`\nLog written to: ${LOG_FILE}`);
  console.error(`Total output: ${output.length} chars`);

  // Print last portion of output
  const tail = output.slice(-3000);
  console.error('\n=== TAIL OF OUTPUT ===\n');
  console.error(tail);
  console.error('\n=== END ===\n');
}

main().catch((e) => {
  console.error('Script failed:', e);
  process.exit(1);
});
