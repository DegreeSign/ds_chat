/** Who a chat message is from */
enum LlmRole {
    system = `system`,
    user = `user`,
    assistant = `assistant`,
}

/** Assistant availability derived from the engine */
enum ChatStatus {
    online = 0,
    away = 1,
    offline = 2,
}

/** On-device engine availability */
enum LlmStatus {
    idle = 0,
    downloading = 1,
    ready = 2,
    error = 3,
    unsupported = 4,
}

/** Which engine runs the model on this device */
enum LlmBackend {
    cpu = `cpu`,
    gpu = `gpu`,
    none = `none`,
}

/** Download or load-into-memory phase of a model load */
enum LlmPhase {
    download = `download`,
    load = `load`,
}

/** Catalog ids of the on-device models */
enum ChatModelId {
    qwen3_vl_2b = `qwen3-vl-2b`,
    gemma4_e2b = `gemma4-e2b`,
}

/** Built-in tools the package ships */
enum BuiltinTool {
    websearch = `websearch`,
    calculate = `calculate`,
    currency = `currency`,
}

/** Search provider behind the websearch tool */
enum WebSearchProvider {
    wikipedia = `wikipedia`,
    duckduckgo = `duckduckgo`,
}

export {
    LlmRole,
    ChatStatus,
    LlmStatus,
    LlmBackend,
    LlmPhase,
    ChatModelId,
    BuiltinTool,
    WebSearchProvider,
};
