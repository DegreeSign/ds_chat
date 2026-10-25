import { LlmPhase } from '../enums';
import { contentLength } from './engine';
import type {
    ResumePlan,
    StartLlmParams,
    StoredModel,
    StoredModelMeta,
    StoredPart,
    StoreDownloadParams,
} from '../types';

const
    /** Directory of the model files inside the origin private file system */
    storeDirName = `litert-store`,
    /** Every model download in flight, shared by every caller */
    downloads = new Map<string, Promise<StoredModel | undefined>>();

let
    /** Whether this process has no writable file system */
    unsupported = false;

const
    /** File name of one model URL */
    storeName = (url: string): string => {
        const file = (url.split(`/`).pop() || `model`)
            .replace(/[^\w.-]+/g, `_`);
        let hash = 0;
        for (let i = 0; i < url.length; i++)
            hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
        return `${hash.toString(16)}-${file}`;
    },
    /** Open the root of the origin private file system */
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
    /** Open the store directory, absent in Node and without a file system */
    storeDir = async (): Promise<FileSystemDirectoryHandle | undefined> => {
        const root = await storeRoot();
        if (!root) return undefined;
        try {
            return await root.getDirectoryHandle(storeDirName, { create: true });
        } catch { return undefined; };
    },
    /** Read the bytes stored for one model file */
    readFile = async (
        dir: FileSystemDirectoryHandle,
        name: string,
    ): Promise<File | undefined> => {
        try {
            const handle = await dir.getFileHandle(name);
            return await handle.getFile();
        } catch { return undefined; };
    },
    /** Read the metadata stored beside one model file */
    readMeta = async (
        dir: FileSystemDirectoryHandle,
        name: string,
    ): Promise<StoredModelMeta | undefined> => {
        try {
            const
                handle = await dir.getFileHandle(`${name}.json`),
                file = await handle.getFile(),
                meta = JSON.parse(await file.text()) as StoredModelMeta;
            return {
                total: Number(meta.total) || 0,
                etag: `${meta.etag || ``}`,
                complete: meta.complete === true,
            };
        } catch { return undefined; };
    },
    /** Write the metadata beside one model file, a failure only costs a resume */
    writeMeta = async (
        dir: FileSystemDirectoryHandle,
        name: string,
        meta: StoredModelMeta,
    ): Promise<void> => {
        try {
            const
                handle = await dir.getFileHandle(`${name}.json`, { create: true }),
                writable = await handle.createWritable();
            await writable.write(JSON.stringify(meta));
            await writable.close();
        } catch { };
    },
    /** Delete one model file and its metadata */
    removeFrom = async (
        dir: FileSystemDirectoryHandle,
        name: string,
    ): Promise<void> => {
        await dir.removeEntry(name).catch(() => { });
        await dir.removeEntry(`${name}.json`).catch(() => { });
    },
    /** Stored bytes and metadata of one model file */
    readStored = async (
        dir: FileSystemDirectoryHandle,
        name: string,
    ): Promise<StoredModel | undefined> => {
        const
            meta = await readMeta(dir, name),
            file = meta ? await readFile(dir, name) : undefined;
        if (!meta || !file) return undefined;
        return {
            file,
            size: file.size,
            total: meta.total,
            etag: meta.etag,
            complete: meta.complete,
        };
    };

const
    /** Where one response continues a stored part, undefined restarts it */
    resumePlan = (
        response: Response,
        part: StoredPart,
    ): ResumePlan | undefined => {
        const
            range = response.headers.get(`content-range`),
            match = /bytes (\d+)-(\d+)\/(\d+)/.exec(range || ``),
            etag = response.headers.get(`etag`) || ``;
        if (response.status == 206) {
            const
                start = match ? Number(match[1]) : -1,
                total = match ? Number(match[3]) : 0;
            // the body must continue exactly where the stored part ends
            if (start != part.size) return undefined;
            if (part.total && total && part.total != total) return undefined;
            if (part.etag && etag && part.etag != etag) return undefined;
            return { start, total: total || part.total, etag: etag || part.etag };
        };
        // a full body over a stored part means the host ignored the range
        if (part.size) return undefined;
        return {
            start: 0,
            total: contentLength(response) || part.total,
            etag: etag || part.etag,
        };
    },
    /** Download and store one model file over at most a few attempts */
    downloadInto = async (
        dir: FileSystemDirectoryHandle,
        url: string,
        signal: AbortSignal | undefined,
        onProgress: StartLlmParams[`onProgress`],
    ): Promise<StoredModel> => {
        const name = storeName(url);
        for (let attempt = 0; attempt < 3; attempt++) {
            const
                stored = await readStored(dir, name),
                part: StoredPart = {
                    size: stored?.size ?? 0,
                    total: stored?.total ?? 0,
                    etag: stored?.etag ?? ``,
                };
            if (stored?.complete) return stored;
            // a crash mid-download must still leave a resumable part
            if (!stored)
                await writeMeta(dir, name, {
                    total: 0,
                    etag: ``,
                    complete: false,
                });
            // a resume needs a closed range, so an unknown size restarts
            if (part.size && !part.total) {
                await removeFrom(dir, name);
                continue;
            };
            const response = await fetch(url, {
                signal,
                headers: part.size
                    ? { Range: `bytes=${part.size}-${part.total - 1}` }
                    : {},
            });
            if (response.status == 416) {
                // the stored bytes already reach the end of the remote file
                if (stored && part.size && part.size == part.total) {
                    const meta: StoredModelMeta = {
                        total: part.total,
                        etag: part.etag,
                        complete: true,
                    };
                    await writeMeta(dir, name, meta);
                    return { ...part, file: stored.file, complete: true };
                };
                await removeFrom(dir, name);
                continue;
            };
            if (!response.ok || !response.body)
                throw new Error(`Model download failed`);
            const plan = resumePlan(response, part);
            if (!plan) {
                // a changed or uncooperative file starts over from zero
                await response.body.cancel().catch(() => { });
                await removeFrom(dir, name);
                continue;
            };
            // record the size before the bytes, so a reload keeps resuming
            await writeMeta(dir, name, {
                total: plan.total,
                etag: plan.etag,
                complete: false,
            });
            const
                handle = await dir.getFileHandle(name, { create: true }),
                writable = await handle.createWritable({ keepExistingData: true });
            let written = plan.start;
            try {
                const reader = response.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    await writable.write({
                        type: `write`,
                        position: written,
                        data: value,
                    });
                    written += value.byteLength;
                    // report the whole file, not only this attempt
                    onProgress(
                        plan.total ? written / plan.total : 0,
                        LlmPhase.download,
                    );
                };
                if (plan.total && written != plan.total)
                    throw new Error(`Model download failed`);
                await writable.close();
            } catch (error) {
                // keep the bytes that arrived, drop a torn tail
                try {
                    await writable.truncate(written);
                    await writable.close();
                } catch { };
                await writeMeta(dir, name, {
                    total: plan.total,
                    etag: plan.etag,
                    complete: false,
                });
                throw error;
            };
            const meta: StoredModelMeta = {
                total: plan.total,
                etag: plan.etag,
                complete: true,
            };
            await writeMeta(dir, name, meta);
            const file = await readFile(dir, name);
            if (!file) throw new Error(`Model download failed`);
            return {
                file,
                size: file.size,
                total: plan.total,
                etag: plan.etag,
                complete: true,
            };
        };
        throw new Error(`Model download failed`);
    };

const
    /** Stored bytes and metadata of one model file, undefined when absent */
    storedModel = async (url: string): Promise<StoredModel | undefined> => {
        const dir = await storeDir();
        return dir ? await readStored(dir, storeName(url)) : undefined;
    },
    /** Download one model file, resuming the part already stored */
    downloadModel = async ({
        url,
        signal,
        onProgress,
    }: StoreDownloadParams): Promise<StoredModel | undefined> => {
        const running = downloads.get(url);
        if (running) return await running;
        const dir = await storeDir();
        if (!dir) return undefined;
        const pending = downloadInto(dir, url, signal, onProgress).finally(() => {
            downloads.delete(url);
        });
        downloads.set(url, pending);
        return await pending;
    },
    /** Delete one stored model file and its metadata */
    removeModel = async (url: string): Promise<void> => {
        const dir = await storeDir();
        if (!dir) return;
        await removeFrom(dir, storeName(url));
    },
    /** Delete the whole store directory and every model file in it */
    purgeModels = async (): Promise<void> => {
        const root = await storeRoot();
        if (!root) return;
        await root.removeEntry(storeDirName, { recursive: true })
            .catch(() => { });
    };

export {
    downloadModel,
    purgeModels,
    removeModel,
    resumePlan,
    storedModel,
};
