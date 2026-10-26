import type { CalculationResult, ChatTool } from '../types';
/** Normalize symbols, then drop spaces and thousands commas */
declare const normalizeExpression: (input: string) => string;
/** Evaluate one normalized arithmetic expression */
declare const evaluateExpression: (expression: string) => number;
/** Parse and evaluate one expression, rejecting unusable input */
declare const calculate: (input: string) => CalculationResult;
declare const calculateTool: ChatTool;
export { calculate, calculateTool, evaluateExpression, normalizeExpression };
