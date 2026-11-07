import { LlmPhase, StoreFault } from '../enums';
import { contentLength } from './engine';
import type {
    ModelStore,
    ResumePlan,
    StartLlmParams,
    StoredFilePart,
    StoredModel,
    StoredModelMeta,
    StoredPart,
    StoreDownloadParams,
} from '../types';

const
    /** Bytes per part, small loss */
    partBytes = 32 * 1024 * 1024,
    /** Attempts with no new bytes */
    maxStalls = 4,
    /** Idle milliseconds before request restarts */
    idleTimeout = 30000,
    /** Failures of the file system */
    storeFaults: ReadonlySet<StoreFault> = new Set([
        StoreFault.quota,
        StoreFault.notAllowed,
        StoreFault.notSupported,
        StoreFault.invalidState,
        StoreFault.typeMismatch,
        StoreFault.security,
    ]),
    /** Shared downloads in flight */
    downloads = new Map<string, Promise<StoredModel | undefined>>(),
    /** URLs whose storage filled */
    quotaFaults = new Set<string>();

let
    /** Whether no writable file system */
    unsupported = false;

const
    /** Directory name of model URL */
    storeName = (url: string): string => {
        const file = (url.split(`/`).pop() || `model`)
            .replace(/[^\w.-]+/g, `_`);
        let hash = 0;
        for (let i = 0; i < url.length; i++)
            hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
        return `${hash.toString(16)}-${file}`;
    },
    /** Part file name and offset */
    partName = (start: number): string => `part-${start}`,
    /** Part offset, -1 for others */
    partOffset = (name: string): number => {
        const match = /^part-(\d+)$/.exec(name);
        return match ? Number(match[1]) : -1;
    },
    /** Contiguous parts until first gap */
    chainParts = (parts: StoredFilePart[]): StoredFilePart[] => {
        const chain: StoredFilePart[] = [];
        let size = 0;
        for (const part of [...parts].sort((a, b) => a.start - b.start)) {
            if (!part.size) continue;
            if (part.start != size) break;
            chain.push(part);
            size += part.size;
        };
        return chain;
    },
    /** Open private file system root */
    storeRoot = async (): Promise<FileSystemDirectoryHandle | undefined> => {
        if (unsupported) return undefined;
        if (typeof navigator == `undefined` || !navigator.storage?.getDirectory) {
            unsupported = true;
            return undefined;
        };
        try {
            return await navigator.storage.getDirectory();
        } catch { return undefined; };
    },
    /** Remaining storage bytes, undefined unknown */
    storageRoom = async (): Promise<number | undefined> => {
        try {
            if (typeof navigator == `undefined` || !navigator.storage?.estimate)
                return undefined;
            const estimate = await navigator.storage.estimate();
            return typeof estimate.quota == `number` && estimate.quota > 0
                ? estimate.quota - (estimate.usage || 0)
                : undefined;
        } catch { return undefined; };
    },
    /** Open model directory if present */
    modelDir = async (
        dir: FileSystemDirectoryHandle,
        name: string,
    ): Promise<FileSystemDirectoryHandle | undefined> => {
        try {
            return await dir.getDirectoryHandle(name);
        } catch { return undefined; };
    },
    /** Parse metadata in one file */
    parseMeta = async (
        handle: FileSystemFileHandle | undefined,
    ): Promise<StoredModelMeta | undefined> => {
        if (!handle) return undefined;
        try {
            const
                file = await handle.getFile(),
                meta = JSON.parse(await file.text()) as StoredModelMeta;
            return {
                total: Number(meta.total) || 0,
                etag: `${meta.etag || ``}`,
                complete: meta.complete === true,
            };
        } catch { return undefined; };
    },
    /** Read metadata beside parts */
    readMeta = async (
        dir: FileSystemDirectoryHandle,
    ): Promise<StoredModelMeta | undefined> =>
        await parseMeta(await dir.getFileHandle(`meta.json`).catch(() => undefined)),
    /** Write metadata beside parts */
    writeMeta = async (
        dir: FileSystemDirectoryHandle,
        meta: StoredModelMeta,
    ): Promise<void> => {
        try {
            const
                handle = await dir.getFileHandle(`meta.json`, { create: true }),
                writable = await handle.createWritable();
            await writable.write(JSON.stringify(meta));
            await writable.close();
        } catch { };
    },
    /** Every directory entry, browser order */
    storeEntries = async function* (
        dir: FileSystemDirectoryHandle,
    ): AsyncGenerator<[string, FileSystemHandle]> {
        for await (const entry of dir as unknown as
            AsyncIterable<[string, FileSystemHandle]>)
            yield entry;
    },
    /** Delete parts, keep metadata */
    removeParts = async (dir: FileSystemDirectoryHandle): Promise<void> => {
        try {
            for await (const [name, handle] of storeEntries(dir))
                if (handle.kind == `file` && partOffset(name) >= 0)
                    await dir.removeEntry(name).catch(() => { });
        } catch { };
    },
    /** Read parts into contiguous prefix */
    readParts = async (
        dir: FileSystemDirectoryHandle,
    ): Promise<{ file: Blob, size: number } | undefined> => {
        const entries: Array<{ part: StoredFilePart, file: File }> = [];
        try {
            for await (const [name, handle] of storeEntries(dir)) {
                const start = partOffset(name);
                if (handle.kind != `file` || start < 0) continue;
                const file = await (handle as FileSystemFileHandle).getFile();
                entries.push({ part: { start, size: file.size }, file });
            };
        } catch { return undefined; };
        const
            chain = chainParts(entries.map(entry => entry.part)),
            starts = new Set(chain.map(part => part.start)),
            files = entries
                .filter(entry => starts.has(entry.part.start))
                .sort((a, b) => a.part.start - b.part.start)
                .map(entry => entry.file);
        if (!files.length) return undefined;
        return {
            file: files.length == 1 ? files[0] : new Blob(files),
            size: chain.reduce((sum, part) => sum + part.size, 0),
        };
    },
    /** Read legacy single-file model */
    readLegacy = async (
        dir: FileSystemDirectoryHandle,
        name: string,
    ): Promise<StoredModel | undefined> => {
        try {
            const
                file = await (await dir.getFileHandle(name)).getFile(),
                meta = await parseMeta(
                    await dir.getFileHandle(`${name}.json`).catch(() => undefined));
            if (!meta) return undefined;
            return {
                file,
                size: file.size,
                total: meta.total,
                etag: meta.etag,
                complete: meta.total
                    ? file.size >= meta.total
                    : meta.complete === true,
            };
        } catch { return undefined; };
    },
    /** Delete model directory and metadata */
    removeFrom = async (
        dir: FileSystemDirectoryHandle,
        name: string,
    ): Promise<void> => {
        await dir.removeEntry(name, { recursive: true }).catch(() => { });
        await dir.removeEntry(`${name}.json`).catch(() => { });
    },
    /** Stored bytes and metadata */
    readStored = async (
        dir: FileSystemDirectoryHandle,
        name: string,
    ): Promise<StoredModel | undefined> => {
        const sub = await modelDir(dir, name);
        if (sub) {
            const
                meta = await readMeta(sub),
                parts = await readParts(sub),
                total = meta?.total || 0,
                size = parts?.size ?? 0,
                file = parts?.file ?? new Blob();
            return {
                file: total && size > total ? file.slice(0, total) : file,
                size,
                total,
                etag: meta?.etag || ``,
                complete: total ? size >= total : meta?.complete === true,
            };
        };
        return await readLegacy(dir, name);
    },
    /** Where response continues parts */
    resumePlan = (
        response: Response,
        part: StoredPart,
    ): ResumePlan | undefined => {
        const
            range = response.headers.get(`content-range`),
            start = /bytes (\d+)-/.exec(range || ``),
            total = /\/(\d+)\s*$/.exec(range || ``),
            etag = response.headers.get(`etag`) || ``;
        if (response.status == 206) {
            const
                // hidden range still continues parts
                offset = start ? Number(start[1]) : part.size,
                length = total ? Number(total[1]) : part.total;
            // body continues where part ends
            if (offset != part.size) return undefined;
            if (part.total && length && part.total != length) return undefined;
            if (part.etag && etag && part.etag != etag) return undefined;
            return { start: offset, total: length || part.total, etag: etag || part.etag };
        };
        // full body restarts partial file
        if (part.etag && etag && part.etag != etag) return undefined;
        return {
            start: 0,
            total: contentLength(response) || part.total,
            etag: etag || part.etag,
        };
    },
    /** Write response body into parts */
    storeBody = async ({
        dir,
        start,
        skip,
        total,
        body,
        onProgress,
        onChunk,
    }: {
        dir: FileSystemDirectoryHandle,
        start: number,
        skip: number,
        total: number,
        body: ReadableStream<Uint8Array>,
        onProgress: StartLlmParams[`onProgress`],
        onChunk: () => void,
    }): Promise<number> => {
        let
            written = start,
            inPart = 0,
            left = skip,
            reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
            writable: FileSystemWritableFileStream | undefined;
        /** Open next part or keep */
        const open = async () => {
            const handle = await dir.getFileHandle(partName(written), { create: true });
            writable = await handle.createWritable();
            inPart = 0;
        };
        /** Commit the part in flight */
        const close = async () => {
            const current = writable;
            writable = undefined;
            if (current) await current.close();
        };
        try {
            const stream = body.getReader();
            reader = stream;
            while (true) {
                const { done, value } = await stream.read();
                if (done) break;
                onChunk();
                let offset = 0;
                // full body replays stored prefix
                if (left) {
                    offset = Math.min(left, value.byteLength);
                    left -= offset;
                };
                while (offset < value.byteLength) {
                    if (!writable) await open();
                    const size = Math.min(
                        partBytes - inPart,
                        value.byteLength - offset,
                    );
                    await writable!.write({
                        type: `write`,
                        position: inPart,
                        data: value.subarray(offset, offset + size) as Uint8Array<ArrayBuffer>,
                    });
                    offset += size;
                    inPart += size;
                    written += size;
                    if (inPart == partBytes) await close();
                };
                if (written > start)
                    onProgress(total ? written / total : 0, LlmPhase.download);
            };
            await close();
        } catch (error) {
            // keep complete parts and tail
            await close().catch(() => { });
            await reader?.cancel().catch(() => { });
            throw error;
        };
        return written;
    },
    /** Download model file as parts */
    downloadInto = async (
        dir: FileSystemDirectoryHandle,
        url: string,
        signal: AbortSignal | undefined,
        onProgress: StartLlmParams[`onProgress`],
    ): Promise<StoredModel> => {
        const
            name = storeName(url),
            legacy = await readLegacy(dir, name);
        if (legacy?.complete) return legacy;
        let sub = await modelDir(dir, name);
        if (!sub) {
            // legacy file cannot hold parts
            await dir.removeEntry(name).catch(() => { });
            await dir.removeEntry(`${name}.json`).catch(() => { });
            sub = await dir.getDirectoryHandle(name, { create: true });
        };
        let
            high = 0,
            stalls = 0,
            roomChecked = false;
        while (true) {
            if (signal?.aborted) throw new Error(`Cancelled`);
            const stored = await readStored(dir, name);
            if (stored?.complete) return stored;
            const
                size = stored?.size ?? 0,
                total = stored?.total || 0,
                etag = stored?.etag || ``;
            // bytes past high water mark
            if (size > high) {
                high = size;
                stalls = 0;
            } else if (++stalls > maxStalls) {
                throw new Error(`Model download failed`);
            };
            // show stored prefix on resume
            if (size && total) onProgress(size / total, LlmPhase.download);
            const
                end = total
                    ? Math.min(size + partBytes, total) - 1
                    : size + partBytes - 1,
                request = new AbortController(),
                leave = () => request.abort(),
                part = { size, total, etag };
            let
                idle = setTimeout(leave, idleTimeout),
                response: Response;
            signal?.addEventListener(`abort`, leave, { once: true });
            try {
                response = await fetch(url, {
                    signal: request.signal,
                    headers: { Range: `bytes=${size}-${end}` },
                });
                if (response.status == 416) {
                    await response.body?.cancel().catch(() => { });
                    // stored bytes reach remote end
                    if (total && size >= total) {
                        await writeMeta(sub, { total, etag, complete: true });
                        continue;
                    };
                    await removeParts(sub);
                    await writeMeta(sub, { total: 0, etag: ``, complete: false });
                    continue;
                };
                if (!response.ok || !response.body) {
                    await response.body?.cancel().catch(() => { });
                    throw new Error(`Model download failed`);
                };
                const plan = resumePlan(response, part);
                if (!plan) {
                    // changed file restarts from zero
                    await response.body.cancel().catch(() => { });
                    await removeParts(sub);
                    await writeMeta(sub, { total: 0, etag: ``, complete: false });
                    continue;
                };
                await writeMeta(sub, {
                    total: plan.total,
                    etag: plan.etag,
                    complete: false,
                });
                const
                    // full body replays stored prefix
                    skip = plan.start == 0 ? size : 0,
                    start = plan.start + skip;
                if (!roomChecked && plan.total > start) {
                    roomChecked = true;
                    const room = await storageRoom();
                    // full storage keeps parts
                    if (room != undefined && room < plan.total - start) {
                        await response.body.cancel().catch(() => { });
                        throw new DOMException(`Storage is full`, StoreFault.quota);
                    };
                };
                const written = await storeBody({
                    dir: sub,
                    start,
                    skip,
                    total: plan.total,
                    body: response.body,
                    onProgress,
                    onChunk: () => {
                        clearTimeout(idle);
                        idle = setTimeout(leave, idleTimeout);
                    },
                });
                if (!plan.total) {
                    await writeMeta(sub, {
                        total: written,
                        etag: plan.etag,
                        complete: true,
                    });
                    const done = await readStored(dir, name);
                    if (done) return done;
                };
            } catch (error) {
                if (signal?.aborted) throw new Error(`Cancelled`);
                // file system failure keeps parts
                if (error instanceof DOMException
                    && storeFaults.has(error.name as StoreFault))
                    throw error;
                // next loop resumes committed parts
                await new Promise(resolve =>
                    setTimeout(resolve, 250 + stalls * 500));
            } finally {
                clearTimeout(idle);
                signal?.removeEventListener(`abort`, leave);
            };
        };
    },
    /** Whether store failure disables storage */
    isStoreError = (error: unknown): boolean =>
        [StoreFault.notAllowed, StoreFault.notSupported]
            .includes((error as DOMException)?.name as StoreFault),
    /** Whether storage quota is full */
    isQuotaError = (error: unknown): boolean =>
        (error as DOMException)?.name == StoreFault.quota;

/** Create engine resumable file store */
const createModelStore = (dirName: string): ModelStore => {
    /** Open this engine's store directory */
    const dir = async (): Promise<FileSystemDirectoryHandle | undefined> => {
        const root = await storeRoot();
        if (!root) return undefined;
        try {
            return await root.getDirectoryHandle(dirName, { create: true });
        } catch { return undefined; };
    };
    return {
        /** Stored bytes and metadata */
        stored: async (url: string): Promise<StoredModel | undefined> => {
            const root = await dir();
            return root ? await readStored(root, storeName(url)) : undefined;
        },
        /** Download file, resuming stored parts */
        download: async ({
            url,
            signal,
            onProgress,
        }: StoreDownloadParams): Promise<StoredModel | undefined> => {
            // full storage streams now
            if (quotaFaults.has(url))
                throw new DOMException(`Storage is full`, StoreFault.quota);
            const key = `${dirName}|${url}`;
            const running = downloads.get(key);
            if (running) return await running;
            const root = await dir();
            if (!root) return undefined;
            const pending = downloadInto(root, url, signal, onProgress)
                .catch(error => {
                    if (isQuotaError(error)) quotaFaults.add(url);
                    throw error;
                })
                .finally(() => {
                    downloads.delete(key);
                });
            downloads.set(key, pending);
            return await pending;
        },
        /** Delete stored file and metadata */
        remove: async (url: string): Promise<void> => {
            quotaFaults.delete(url);
            const root = await dir();
            if (!root) return;
            await removeFrom(root, storeName(url));
        },
        /** Delete whole store directory */
        purge: async (): Promise<void> => {
            quotaFaults.clear();
            const root = await storeRoot();
            if (!root) return;
            await root.removeEntry(dirName, { recursive: true }).catch(() => { });
        },
    };
};

export {
    chainParts,
    createModelStore,
    isQuotaError,
    isStoreError,
    resumePlan,
};
