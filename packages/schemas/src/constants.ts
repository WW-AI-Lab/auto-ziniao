export const KNOWN_ZCLAW_TOOLS = [
  "list_stores",
  "resolve_store",
  "open_store",
  "close_store",
  "visit_page",
  "get_page_content",
  "query_elements",
  "click_element",
  "input_text",
  "scroll_page",
  "take_screenshot",
  "wait_for_element",
  "wait_for_navigation",
  "execute_script",
  "run_automation",
  "extract_data",
  "prepare_agent",
  "download_file",
  "get_logs",
  "debug_compare_lists"
] as const;

export const KNOWN_FLOW_ACTIONS = [
  "sleep",
  "save_csv",
  "save_json",
  "print",
  "assert",
  "close_store",
  "goto",
  "branch",
  "fail"
] as const;

export const ON_FAIL_ACTIONS = [
  "abort",
  "retry",
  "skip",
  "branch",
  "heal"
] as const;

export const CONDITION_TYPES = [
  "eq",
  "ne",
  "contains",
  "not_contains",
  "starts_with",
  "is_true",
  "is_false",
  "gt",
  "lt",
  "is_empty",
  "not_empty"
] as const;

export const VALIDATION_KEYS = [
  "not_empty",
  "min_rows",
  "require_fields",
  "contains",
  "path"
] as const;

export type KnownZclawTool = (typeof KNOWN_ZCLAW_TOOLS)[number];
export type KnownFlowAction = (typeof KNOWN_FLOW_ACTIONS)[number];
export type OnFailAction = (typeof ON_FAIL_ACTIONS)[number];
export type ConditionType = (typeof CONDITION_TYPES)[number];

export const KNOWN_ZCLAW_TOOL_SET = new Set<string>(KNOWN_ZCLAW_TOOLS);
export const KNOWN_FLOW_ACTION_SET = new Set<string>(KNOWN_FLOW_ACTIONS);
export const ON_FAIL_ACTION_SET = new Set<string>(ON_FAIL_ACTIONS);
export const CONDITION_TYPE_SET = new Set<string>(CONDITION_TYPES);
