import { BuiltinTool } from '../types/enums';
import { calculateTool } from './calculator';
import { currencyTool } from './currency';
import { webSearchTool } from './search';
import type { ChatTool, WebSearchConfig } from '../types';
/** Build built-ins in given order */
declare const builtinTools: (builtins: BuiltinTool[], config?: WebSearchConfig) => ChatTool[];
export { builtinTools, calculateTool, currencyTool, webSearchTool };
