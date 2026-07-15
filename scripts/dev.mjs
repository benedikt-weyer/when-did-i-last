import net from 'node:net';
import { spawn } from 'node:child_process';

const DEFAULT_POSTGRES_PORT = 5432;
const MAX_POSTGRES_PORT = 65_535;

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

async function findAvailablePostgresPort() {
  for (let port = DEFAULT_POSTGRES_PORT; port <= MAX_POSTGRES_PORT; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error('No available TCP port found for Postgres.');
}

async function main() {
  await run('docker', ['compose', 'down']);

  const postgresPort = await findAvailablePostgresPort();
  const databaseUrl = `postgres://preset:preset@localhost:${postgresPort}/preset`;
  console.log(`Starting Postgres on localhost:${postgresPort}`);

  await run('docker', ['compose', 'up', '-d'], {
    env: {
      ...process.env,
      POSTGRES_PORT: String(postgresPort),
    },
  });

  await run('turbo', ['dev', '--ui=tui'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
