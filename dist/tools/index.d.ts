import { BuiltinTool } from '../enums';
import type { ChatInput, ChatTool, ResolvedTools, WebSearchConfig } from '../types';
/** Default built-in set, attached to every call unless the host changes it */
declare const defaultBuiltins: BuiltinTool[];
/** Build the selected built-ins, in the order the host asked for */
declare const builtinTools: (builtins: BuiltinTool[], config?: WebSearchConfig) => ChatTool[];
/** Resolve the built-ins and the host tools into one ordered tool list */
declare const resolveChatTools: (input: ChatInput) => ResolvedTools;
export { builtinTools, defaultBuiltins, resolveChatTools };
