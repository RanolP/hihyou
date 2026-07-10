/**
 * In-browser apply: the user grants a directory handle to their local
 * checkout (File System Access API) once per repo; patches then edit the
 * working tree directly — no daemon, everything in the browser.
 */

declare global {
  interface Window {
    showDirectoryPicker(options?: {
      mode?: 'read' | 'readwrite';
      id?: string;
    }): Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  }
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hihyou-fs', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('repos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, key: string) {
  return new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
    const req = db.transaction('repos').objectStore('repos').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: FileSystemDirectoryHandle) {
  return new Promise<void>((resolve, reject) => {
    const req = db
      .transaction('repos', 'readwrite')
      .objectStore('repos')
      .put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Stored handle if permitted, else prompt (needs a user gesture). */
export async function getRepoDir(
  repoKey: string,
): Promise<FileSystemDirectoryHandle> {
  const db = await idb();
  const stored = await idbGet(db, repoKey);
  if (stored) {
    if ((await stored.queryPermission({ mode: 'readwrite' })) === 'granted')
      return stored;
    if ((await stored.requestPermission({ mode: 'readwrite' })) === 'granted')
      return stored;
  }
  const handle = await window.showDirectoryPicker({
    mode: 'readwrite',
    id: `hihyou-${repoKey.replace(/[^a-z0-9]/gi, '-')}`,
  });
  await idbPut(db, repoKey, handle);
  return handle;
}

async function fileHandleAt(
  dir: FileSystemDirectoryHandle,
  relPath: string,
): Promise<FileSystemFileHandle> {
  const segments = relPath.split('/');
  let cur = dir;
  for (const segment of segments.slice(0, -1)) {
    cur = await cur.getDirectoryHandle(segment);
  }
  return cur.getFileHandle(segments[segments.length - 1]);
}

export async function readRepoFile(
  dir: FileSystemDirectoryHandle,
  relPath: string,
): Promise<string> {
  const file = await (await fileHandleAt(dir, relPath)).getFile();
  return file.text();
}

export async function writeRepoFile(
  dir: FileSystemDirectoryHandle,
  relPath: string,
  content: string,
): Promise<void> {
  const handle = await fileHandleAt(dir, relPath);
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}
