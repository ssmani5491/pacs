/**
 * Archive compression worker (PACS Operations Module 2).
 *
 * Runs in a Node worker_thread so CPU-bound gzip does not block the API event
 * loop. It receives a source buffer path (the Orthanc study ZIP, already written
 * to a temp file) + a destination path + gzip level, streams gzip to the
 * destination, and returns the compressed size + SHA-256 of the output file.
 *
 * It NEVER touches Orthanc or original DICOM files — it only compresses a ZIP the
 * caller already produced, into a new file. Lossless (gzip of a ZIP container).
 */
import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { pipeline } from 'stream/promises';

interface Task { srcPath: string; destPath: string; level: number }

async function run({ srcPath, destPath, level }: Task) {
  const hash = crypto.createHash('sha256');
  const gzip = zlib.createGzip({ level: Math.max(0, Math.min(9, level)) });
  const input = fs.createReadStream(srcPath);
  const output = fs.createWriteStream(destPath);

  // Tee the gzipped bytes through the hash as they are written.
  gzip.on('data', (chunk) => hash.update(chunk));
  await pipeline(input, gzip, output);

  const stat = fs.statSync(destPath);
  return { compressedBytes: stat.size, sha256: hash.digest('hex') };
}

run(workerData as Task)
  .then((res) => parentPort?.postMessage({ ok: true, ...res }))
  .catch((err) => parentPort?.postMessage({ ok: false, error: String(err?.message ?? err) }));
