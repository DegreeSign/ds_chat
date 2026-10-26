import { pNum, rNum } from '@degreesign/utils';
import type { CalculationResult, ChatTool, ChatToolValue } from '../types';

/** Characters accepted after normalization */
const allowedPattern = /^[0-9+\-*/%^().]+$/;
/** Longest expression accepted, characters */
const maxExpressionLength = 200;
/** Results at or above this value keep six decimals through pNum */
const exactLimit = 1e5;
/** Decimals kept by rNum below the exact limit */
const resultDigits = 12;

/** Normalize symbols, then drop spaces and thousands commas */
const normalizeExpression = (input: string): string =>
    input
        .replace(/×/g, `*`)
        .replace(/÷/g, `/`)
        .replace(/−/g, `-`)
        .replace(/,/g, ``)
        .replace(/\s+/g, ``);

/** Evaluate one normalized arithmetic expression */
const evaluateExpression = (expression: string): number => {
    let at = 0;
    const
        /** Whether one character is a decimal digit */
        digit = (char?: string): boolean => !!char && char >= `0` && char <= `9`,
        /** Reject the expression with one clear message */
        fail = (message: string): never => {
            throw new Error(message);
        },
        /** Read one decimal number */
        parseNumber = (): number => {
            const start = at;
            while (digit(expression[at])) at++;
            const whole = expression.slice(start, at);
            let fraction = ``;
            if (expression[at] == `.`) {
                at++;
                const from = at;
                while (digit(expression[at])) at++;
                fraction = expression.slice(from, at);
            };
            if (!whole && !fraction) return fail(`Expected a number`);
            return Number(`${whole || `0`}.${fraction || `0`}`);
        },
        /** Read a number or a group, then its postfix percents */
        parsePrimary = (): number => {
            let value: number;
            if (expression[at] == `(`) {
                at++;
                value = parseSum();
                if (expression[at] != `)`) fail(`Unbalanced parentheses`);
                at++;
            } else value = parseNumber();
            while (expression[at] == `%`) {
                at++;
                value /= 100;
            };
            return value;
        },
        /** Read a power, right associative */
        parsePower = (): number => {
            const base = parsePrimary();
            if (expression[at] != `^`) return base;
            at++;
            return base ** parseUnary();
        },
        /** Read one unary sign over a power */
        parseUnary = (): number => {
            if (expression[at] == `+`) {
                at++;
                return parseUnary();
            };
            if (expression[at] == `-`) {
                at++;
                return -parseUnary();
            };
            return parsePower();
        },
        /** Read a product or a quotient */
        parseProduct = (): number => {
            let value = parseUnary();
            while (expression[at] == `*` || expression[at] == `/`) {
                const operator = expression[at];
                at++;
                const next = parseUnary();
                if (operator == `*`) value *= next;
                else {
                    if (!next) fail(`Division by zero`);
                    value /= next;
                };
            };
            return value;
        },
        /** Read a sum or a difference */
        parseSum = (): number => {
            let value = parseProduct();
            while (expression[at] == `+` || expression[at] == `-`) {
                const operator = expression[at];
                at++;
                const next = parseProduct();
                value = operator == `+` ? value + next : value - next;
            };
            return value;
        };
    const result = parseSum();
    if (at < expression.length) fail(`Unexpected character`);
    if (!Number.isFinite(result)) fail(`Result is not a finite number`);
    return result;
};

/** Parse and evaluate one expression, rejecting unusable input */
const calculate = (input: string): CalculationResult => {
    if (input.trim().length > maxExpressionLength)
        throw new Error(`Expression is too long`);
    const expression = normalizeExpression(input);
    if (!expression) throw new Error(`Expression is empty`);
    if (!allowedPattern.test(expression)) throw new Error(`Unsupported character`);
    const value = evaluateExpression(expression);
    const result = Math.abs(value) >= exactLimit
        ? pNum(value) ?? value
        : rNum(value, resultDigits);
    return { expression, result };
};

const calculateTool: ChatTool = {
    name: `calculate`,
    description: `Evaluate an arithmetic expression. `
        + `Supports + - * / % ^ and parentheses; % divides by 100.`,
    parameters: {
        type: `object`,
        properties: {
            expression: {
                type: `string`,
                description: `Arithmetic expression, for example 2*(3+4)`,
            },
        },
        required: [`expression`],
    },
    execute: args => {
        const expression = args.expression;
        if (typeof expression != `string`) throw new Error(`Missing expression`);
        // the result object is JSON-safe
        return calculate(expression) as unknown as ChatToolValue;
    },
};

export { calculate, calculateTool, evaluateExpression, normalizeExpression };
