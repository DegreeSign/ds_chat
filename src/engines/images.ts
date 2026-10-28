import type { EngineContentPart, EngineMessage, ImageSize } from '../types';

const
    /** Vision token target */
    imageTokens = 64,
    /** Pixels per vision token */
    tokenCell = 32,
    /** Tokens allowed above the target */
    tokenSlack = 8;

/** Square size the WebGPU engine encodes */
const gpuImageSize: ImageSize = { width: 384, height: 384 };

/** Read a blob back as a data URL */
const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise(resolve => {
        if (typeof FileReader == `undefined`) {
            resolve(``);
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => resolve(``);
        reader.onload = () => resolve(`${reader.result}`);
        reader.readAsDataURL(blob);
    });

/** Create a 2d canvas on the main thread or in a worker */
const createCanvas = (
    width: number,
    height: number,
): OffscreenCanvas | HTMLCanvasElement | undefined => {
    if (typeof OffscreenCanvas != `undefined`)
        return new OffscreenCanvas(width, height);
    if (typeof document == `undefined`) return undefined;
    const canvas = document.createElement(`canvas`);
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

/** Whether a canvas can encode itself without the DOM */
const isOffscreen = (
    canvas: OffscreenCanvas | HTMLCanvasElement,
): canvas is OffscreenCanvas =>
    typeof OffscreenCanvas != `undefined` && canvas instanceof OffscreenCanvas;

/** Decode a data URL or fetch a URL into bytes for an engine */
const contentBuffer = async (url: string): Promise<ArrayBuffer> => {
    if (!url.startsWith(`data:`))
        return await (await fetch(url)).arrayBuffer();
    const
        comma = url.indexOf(`,`),
        head = comma >= 0 ? url.slice(0, comma) : ``;
    if (comma < 0) throw new Error(`Invalid image data`);
    if (!head.includes(`;base64`))
        return await (await fetch(url)).arrayBuffer();
    const
        binary = atob(url.slice(comma + 1)),
        bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
};

/** Full-frame size near the token target */
const visionSize = (width: number, height: number): ImageSize => {
    const aspect = width / Math.max(1, height);
    let
        bestWidth = tokenCell,
        bestHeight = tokenCell,
        bestError = Infinity,
        bestTokens = Infinity;
    for (let rows = 1; rows <= imageTokens; rows++) {
        const
            firstCols = Math.ceil(imageTokens / rows),
            lastCols = Math.floor((imageTokens + tokenSlack) / rows);
        for (let cols = firstCols; cols <= lastCols; cols++) {
            const
                tokens = cols * rows,
                error = Math.abs(cols / rows - aspect);
            if (error < bestError - 1e-9
                || (Math.abs(error - bestError) <= 1e-9 && tokens < bestTokens)) {
                bestWidth = cols * tokenCell;
                bestHeight = rows * tokenCell;
                bestError = error;
                bestTokens = tokens;
            }
        }
    }
    return { width: bestWidth, height: bestHeight };
};

/** Fit one image URL to the token grid for an engine */
const resizeImageUrl = async (
    url: string,
    size?: ImageSize,
): Promise<string> => {
    if (!url || typeof fetch != `function` || typeof createImageBitmap != `function`)
        return url;
    try {
        const
            response = await fetch(url),
            bitmap = await createImageBitmap(await response.blob()),
            target = size ?? visionSize(bitmap.width, bitmap.height),
            sourceAspect = bitmap.width / Math.max(1, bitmap.height),
            targetAspect = target.width / target.height,
            sourceWidth = Math.min(
                bitmap.width,
                sourceAspect > targetAspect
                    ? bitmap.height * targetAspect
                    : bitmap.width,
            ),
            sourceHeight = Math.min(
                bitmap.height,
                sourceAspect > targetAspect
                    ? bitmap.height
                    : bitmap.width / targetAspect,
            ),
            sourceX = (bitmap.width - sourceWidth) / 2,
            sourceY = (bitmap.height - sourceHeight) / 2,
            canvas = createCanvas(target.width, target.height),
            context = canvas
                ? canvas.getContext(`2d`) as
                    | CanvasRenderingContext2D
                    | OffscreenCanvasRenderingContext2D
                    | null
                : null;
        if (!canvas || !context || bitmap.width < 1 || bitmap.height < 1) {
            bitmap.close();
            return url;
        }
        context.drawImage(
            bitmap,
            sourceX, sourceY, sourceWidth, sourceHeight,
            0, 0, target.width, target.height,
        );
        bitmap.close();
        if (isOffscreen(canvas)) {
            const blob = await canvas.convertToBlob({
                type: `image/jpeg`,
                quality: 0.85,
            });
            return await blobToDataUrl(blob) || url;
        }
        return canvas.toDataURL(`image/jpeg`, 0.85);
    } catch { return url; }
};

/** Fit every image part before an engine sees it */
const resizeImages = async (
    messages: EngineMessage[],
    size?: ImageSize,
): Promise<EngineMessage[]> => {
    const resized: EngineMessage[] = [];
    for (const message of messages) {
        if (typeof message.content == `string`) {
            resized.push(message);
            continue;
        }
        const parts: EngineContentPart[] = [];
        for (const part of message.content)
            parts.push(part.type == `image`
                ? { type: `image`, url: await resizeImageUrl(part.url, size) }
                : part);
        resized.push({ role: `user`, content: parts });
    }
    return resized;
};

export {
    gpuImageSize,
    imageTokens,
    tokenCell,
    tokenSlack,
    visionSize,
    contentBuffer,
    resizeImageUrl,
    resizeImages,
};
