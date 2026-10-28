/** Write one package log line when logging is on */
const log = (logging: boolean | undefined, ...args: unknown[]) => {
    if (logging !== true) return;
    console.log(...args);
};

export { log };
