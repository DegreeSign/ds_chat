/** Author of a chat message */
declare enum LlmRole {
    system = "system",
    user = "user",
    assistant = "assistant"
}
/** Assistant availability from engine */
declare enum ChatStatus {
    online = 0,
    away = 1,
    offline = 2
}
/** On-device engine availability */
declare enum LlmStatus {
    idle = 0,
    downloading = 1,
    ready = 2,
    error = 3,
    unsupported = 4
}
/** Engine running the model */
declare enum LlmBackend {
    cpu = "cpu",
    gpu = "gpu",
    none = "none"
}
/** Download or load phase */
declare enum LlmPhase {
    download = "download",
    load = "load"
}
/** File system failure names */
declare enum StoreFault {
    quota = "QuotaExceededError",
    notAllowed = "NotAllowedError",
    notSupported = "NotSupportedError",
    invalidState = "InvalidStateError",
    typeMismatch = "TypeMismatchError",
    security = "SecurityError"
}
/** Catalog ids of on-device models */
declare enum ChatModelId {
    qwen3_vl_2b = "qwen3-vl-2b",
    qwen3_vl_2b_instruct = "qwen3-vl-2b-instruct",
    qwen3_vl_2b_instruct_q3 = "qwen3-vl-2b-instruct-q3",
    gemma4_e2b_limited = "gemma4-e2b-limited"
}
/** Built-in tools the package ships */
declare enum BuiltinTool {
    websearch = "websearch",
    calculate = "calculate",
    currency = "currency"
}
/** Provider behind the websearch tool */
declare enum WebSearchProvider {
    wikipedia = "wikipedia",
    duckduckgo = "duckduckgo"
}
export { LlmRole, ChatStatus, LlmStatus, LlmBackend, LlmPhase, StoreFault, ChatModelId, BuiltinTool, WebSearchProvider, };
