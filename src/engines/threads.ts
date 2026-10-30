/** Logical cores minus a fifth, one kept free for the page */
const heuristicThreads = (cores: number): number => {
    const total = cores || 4;
    return Math.max(1, total - Math.max(1, Math.floor(total / 5)));
};

export { heuristicThreads };
