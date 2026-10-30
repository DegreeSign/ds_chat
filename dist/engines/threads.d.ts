/** Logical cores minus a fifth, one kept free for the page */
declare const heuristicThreads: (cores: number) => number;
export { heuristicThreads };
