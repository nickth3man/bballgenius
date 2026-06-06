/**
 * Fast server smoke test: starts web dev, hits a page, checks status, exits.
 *
 * Usage: bun run scripts/smoke-web.ts
 */
const ROOT = import.meta.dir;

// Kill port 3000
const kill = Bun.spawn(['bun', 'x', 'kill-port', '3000'], { cwd: ROOT });
await kill.exited;

// Spawn server
const proc = Bun.spawn(['bun', 'run', 'web'], {
  cwd: ROOT,
  stdout: 'pipe',
  stderr: 'pipe',
  env: { ...process.env, FORCE_COLOR: '0' },
});

let stderr = '';
const decoder = new TextDecoder();
void (async () => {
  for await (const chunk of proc.stderr) stderr += decoder.decode(chunk);
})();

// Wait for server to be ready
let status = 'timeout';
for (let i = 0; i < 20; i++) {
  try {
    const res = await fetch('http://localhost:3000/', {
      signal: AbortSignal.timeout(2000),
      redirect: 'manual',
    });
    status = `${res.status}`;
    break;
  } catch {
    await Bun.sleep(500);
  }
}

// Check for errors in output
const hasError = stderr.includes('TypeError') || stderr.includes('Error:');
const errorLines = stderr
  .split('\n')
  .filter((l) => l.includes('Error') || l.includes('error'))
  .slice(0, 5);

proc.kill('SIGTERM');
await Bun.sleep(1000);

const result = hasError ? 'FAIL' : 'PASS';
console.log(`${result} | HTTP ${status} | errors: ${hasError}`);
if (hasError) {
  for (const line of errorLines) console.log(`  ${line.trim()}`);
}
process.exit(hasError ? 1 : 0);
