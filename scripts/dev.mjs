import net from 'node:net';
import { spawn } from 'node:child_process';

const DEFAULT_POSTGRES_PORT = 5432;
const DEFAULT_BACKEND_PORT = 4000;
const MAX_PORT = 65_535;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.once('listening', () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(true);
      });
    });

    server.listen({ host: '0.0.0.0', port, exclusive: true });
  });
}

async function findAvailablePort(startPort, label) {
  for (let port = startPort; port <= MAX_PORT; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available TCP port found for ${label}.`);
}

async function main() {
  await run('docker', ['compose', 'down']);

  const postgresPort = await findAvailablePort(DEFAULT_POSTGRES_PORT, 'Postgres');
  const databaseUrl = `postgres://preset:preset@localhost:${postgresPort}/preset`;
  console.log(`Starting Postgres on localhost:${postgresPort}`);

  await run('docker', ['compose', 'up', '-d'], {
    env: {
      ...process.env,
      POSTGRES_PORT: String(postgresPort),
    },
  });

  const backendPort = await findAvailablePort(DEFAULT_BACKEND_PORT, 'the backend');
  const apiBaseUrl = `http://127.0.0.1:${backendPort}`;
  console.log(`Starting backend on localhost:${backendPort}`);

  await run('turbo', ['dev', '--ui=tui'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      BACKEND_PORT: String(backendPort),
      API_BASE_URL: apiBaseUrl,
    },
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
