import type { CalculationResult, ChatTool } from '../types';
declare const 
/** Normalize symbols, spaces and commas */
normalizeExpression: (input: string) => string, 
/** Evaluate one normalized arithmetic expression */
evaluateExpression: (expression: string) => number, 
/** Parse expression, rejecting unusable input */
calculate: (input: string) => CalculationResult, calculateTool: ChatTool;
export { calculate, calculateTool, evaluateExpression, normalizeExpression };
