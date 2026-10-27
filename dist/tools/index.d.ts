import { BuiltinTool } from '../enums';
import { calculateTool } from './calculator';
import { currencyTool } from './currency';
import { webSearchTool } from './search';
import type { ChatTool, WebSearchConfig } from '../types';
/** Build the requested built-ins, in the order given */
declare const builtinTools: (builtins: BuiltinTool[], config?: WebSearchConfig) => ChatTool[];
export { builtinTools, calculateTool, currencyTool, webSearchTool };
