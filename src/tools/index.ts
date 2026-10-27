import { BuiltinTool } from '../enums';
import { calculateTool } from './calculator';
import { currencyTool } from './currency';
import { webSearchTool } from './search';
import type { ChatTool, WebSearchConfig } from '../types';

/** Build the requested built-ins, in the order given */
const builtinTools = (
    builtins: BuiltinTool[],
    config?: WebSearchConfig,
): ChatTool[] => {
    const tools: ChatTool[] = [];
    for (const name of builtins) {
        if (name == BuiltinTool.websearch) tools.push(webSearchTool(config));
        else if (name == BuiltinTool.calculate) tools.push(calculateTool);
        else if (name == BuiltinTool.currency) tools.push(currencyTool);
    };
    return tools;
};

export { builtinTools, calculateTool, currencyTool, webSearchTool };
