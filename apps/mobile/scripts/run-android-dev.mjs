/* global console, process */

import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const backendPort = parseBackendPort(process.env.BACKEND_PORT);
const backendUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || `http://127.0.0.1:${backendPort}`;
const adbCommand = process.env.ADB?.trim() || 'adb';
const expoCommand = process.platform === 'win32' ? 'expo.cmd' : 'expo';

let keepForwarding = true;
let hasForwardedPort = false;
let hasReportedWait = false;

const expoProcess = spawn(expoCommand, ['run:android'], {
  env: {
    ...process.env,
    EXPO_PUBLIC_API_BASE_URL: backendUrl,
  },
  stdio: 'inherit',
});

expoProcess.on('exit', () => {
  keepForwarding = false;
});

const reversePromise = keepAndroidPortForwarded();

try {
  const exitCode = await new Promise((resolve, reject) => {
    expoProcess.on('error', reject);
    expoProcess.on('close', (code) => {
      resolve(code ?? 1);
    });
  });

  keepForwarding = false;
  await reversePromise;
  process.exit(exitCode);
} catch (error) {
  keepForwarding = false;
  await reversePromise;
  throw error;
}

async function keepAndroidPortForwarded() {
  while (keepForwarding) {
    try {
      execFileSync(
        adbCommand,
        ['reverse', `tcp:${backendPort}`, `tcp:${backendPort}`],
        { stdio: 'ignore' },
      );

      if (!hasForwardedPort) {
        console.log(
          `[mobile] Forwarded Android tcp:${backendPort} to host tcp:${backendPort}. Using ${backendUrl}.`,
        );
      }

      hasForwardedPort = true;
      hasReportedWait = false;
      await delay(5000);
    } catch (error) {
      if (isMissingCommand(error)) {
        console.warn('[mobile] adb was not found, so backend port forwarding was skipped.');
        return;
      }

      if (!hasReportedWait) {
        console.log(
          `[mobile] Waiting for an Android device before forwarding tcp:${backendPort}. Using ${backendUrl}.`,
        );
        hasReportedWait = true;
      }

      await delay(2000);
    }
  }
}

function isMissingCommand(error) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function parseBackendPort(value) {
  const parsedPort = Number.parseInt(value ?? '', 10);

  if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    return parsedPort;
  }

  return 4000;
}