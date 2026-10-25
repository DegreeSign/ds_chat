import type { EngineContentPart, EngineMessage } from '../types';

/** Square image side sent to an engine, a multiple of 48 */
const imageSide = 288;

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

/** Decode an image URL into bytes for an engine */
const imageBuffer = async (url: string): Promise<ArrayBuffer> => {
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

/** Center-crop one image URL to a square and resize it for an engine */
const resizeImageUrl = async (url: string): Promise<string> => {
    if (!url || typeof fetch != `function` || typeof createImageBitmap != `function`)
        return url;
    try {
        const
            response = await fetch(url),
            bitmap = await createImageBitmap(await response.blob()),
            side = Math.min(bitmap.width, bitmap.height),
            sourceX = Math.floor((bitmap.width - side) / 2),
            sourceY = Math.floor((bitmap.height - side) / 2),
            canvas = createCanvas(imageSide, imageSide),
            context = canvas
                ? canvas.getContext(`2d`) as
                    | CanvasRenderingContext2D
                    | OffscreenCanvasRenderingContext2D
                    | null
                : null;
        if (!canvas || !context || side < 1) {
            bitmap.close();
            return url;
        }
        context.drawImage(
            bitmap,
            sourceX, sourceY, side, side,
            0, 0, imageSide, imageSide,
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

/** Center-crop and resize every image part before an engine sees it */
const resizeImages = async (
    messages: EngineMessage[],
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
                ? { type: `image`, url: await resizeImageUrl(part.url) }
                : part);
        resized.push({ role: `user`, content: parts });
    }
    return resized;
};

export {
    imageSide,
    imageBuffer,
    resizeImageUrl,
    resizeImages,
};
