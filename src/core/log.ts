/** Write log line when enabled */
const log = (logging: boolean | undefined, ...args: unknown[]) => {
    if (logging !== true) return;
    console.log(...args);
};

export { log };
