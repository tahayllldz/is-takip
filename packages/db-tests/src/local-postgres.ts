/**
 * Docker gerektirmeyen yerel Postgres 17 (yalnızca testler için).
 *
 * İkili dosyalar `@embedded-postgres/<platform>` paketinden gelir. Proje yolu
 * Türkçe karakter içerdiğinde (ör. "İS TAKİP") Postgres kendi kurulum yolunu
 * UTF-8 olarak çözemiyor; bu yüzden ikili dosyalar bir kez ASCII bir önbellek
 * dizinine kopyalanır ve oradan çalıştırılır.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pg from 'pg';

const require = createRequire(import.meta.url);

function platformPackage(): string {
  const p = platform();
  const a = process.arch;
  if (p === 'win32') return '@embedded-postgres/windows-x64';
  if (p === 'darwin') return a === 'arm64' ? '@embedded-postgres/darwin-arm64' : '@embedded-postgres/darwin-x64';
  return a === 'arm64' ? '@embedded-postgres/linux-arm64' : '@embedded-postgres/linux-x64';
}

function nativeDir(): string {
  // embedded-postgres paketinin bağımlılığı olarak kurulur
  const epMain = require.resolve('embedded-postgres');
  const fromEp = createRequire(epMain);
  // Paket yalnızca ./dist/index.js dışa aktarır; kök dizine oradan çıkılır.
  const entry = fromEp.resolve(platformPackage());
  return join(dirname(entry), '..', 'native');
}

function asciiCacheDir(): string {
  const base = process.env.LOCALAPPDATA ?? join(homedir(), '.cache');
  return join(base, 'istakip', 'pg-17');
}

function binaries(): string {
  const src = nativeDir();
  const dst = asciiCacheDir();
  const marker = join(dst, 'bin', platform() === 'win32' ? 'postgres.exe' : 'postgres');
  if (!existsSync(marker)) {
    mkdirSync(dst, { recursive: true });
    cpSync(src, dst, { recursive: true, dereference: true });
  }
  return join(dst, 'bin');
}

export interface LocalPostgres {
  url: (db?: string) => string;
  stop: () => Promise<void>;
}

async function waitForReady(port: number, proc: ChildProcess, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  let lastErr: unknown;
  while (Date.now() - started < timeoutMs) {
    if (proc.exitCode !== null) throw new Error(`Postgres kapandı (kod ${proc.exitCode}).`);
    const c = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
    try {
      await c.connect();
      await c.end();
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Postgres zamanında hazır olmadı: ${String(lastErr)}`);
}

export async function startLocalPostgres(): Promise<LocalPostgres> {
  const bin = binaries();
  const exe = (n: string) => join(bin, platform() === 'win32' ? `${n}.exe` : n);
  const dataDir = mkdtempSync(join(tmpdir(), 'istakip-pg-'));
  const port = 55000 + Math.floor(Math.random() * 900);

  const init = spawnSync(exe('initdb'), ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync'], {
    encoding: 'utf8',
  });
  if (init.status !== 0) {
    throw new Error(`initdb başarısız:\n${init.stderr || init.stdout}`);
  }

  const proc = spawn(exe('postgres'), ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'fsync=off'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr?.on('data', (d) => {
    stderr = (stderr + String(d)).slice(-4000);
  });

  try {
    await waitForReady(port, proc);
  } catch (e) {
    proc.kill();
    throw new Error(`${(e as Error).message}\n${stderr}`);
  }

  return {
    url: (db = 'postgres') => `postgresql://postgres@127.0.0.1:${port}/${db}`,
    stop: async () => {
      spawnSync(exe('pg_ctl'), ['stop', '-D', dataDir, '-m', 'fast', '-w'], { encoding: 'utf8' });
      if (proc.exitCode === null) proc.kill();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
