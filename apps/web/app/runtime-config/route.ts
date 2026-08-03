import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

async function readDevBackendUrl() {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  try {
    const filePath = path.join(process.cwd(), '..', '..', '.run', 'backend-url');
    const contents = await readFile(filePath, 'utf8');
    return contents.trim() || null;
  } catch {
    return null;
  }
}

async function readRuntimeConfig() {
  const devBackendUrl = await readDevBackendUrl();

  return {
    backendUrl: devBackendUrl ?? process.env.API_BASE_URL?.trim() ?? '',
  };
}

export async function GET() {
  return new Response(
    `window.__RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(await readRuntimeConfig())});`,
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': 'application/javascript; charset=utf-8',
      },
    },
  );
}
