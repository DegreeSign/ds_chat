import { BuiltinTool } from '../enums';
import { calculateTool } from './calculator';
import { currencyTool } from './currency';
import { webSearchTool } from './search';
import type {
    ChatInput,
    ChatTool,
    ResolvedTools,
    WebSearchConfig,
} from '../types';

/** Default built-in set, attached to every call unless the host changes it */
const defaultBuiltins: BuiltinTool[] = [
    BuiltinTool.websearch,
    BuiltinTool.calculate,
    BuiltinTool.currency,
];

/** Build the selected built-ins, in the order the host asked for */
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

/** Resolve the built-ins and the host tools into one ordered tool list */
const resolveChatTools = (input: ChatInput): ResolvedTools => {
    const
        host = input.tools ?? [],
        builtins = input.builtins === false
            ? []
            : input.builtins ?? defaultBuiltins,
        names = new Set<string>(),
        tools: ChatTool[] = [];
    for (const tool of host) {
        if (names.has(tool.name)) throw new Error(`Duplicate tool name ${tool.name}`);
        names.add(tool.name);
    };
    // a host tool replaces the built-in of the same name
    for (const tool of builtinTools(builtins, input.websearch))
        if (!names.has(tool.name)) tools.push(tool);
    tools.push(...host);
    return { tools, explicit: host.length > 0 };
};

export { builtinTools, defaultBuiltins, resolveChatTools };
