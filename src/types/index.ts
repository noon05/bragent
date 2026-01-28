// Типы для AI Agent

export interface PageElement {
  index: number;
  tag: string;
  text: string;
  selector: string;
  attributes: Record<string, string>;
  isInteractive: boolean;
  isVisible: boolean;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PageContext {
  url: string;
  title: string;
  elements: PageElement[];
  textContent: string;
  forms: FormInfo[];
  links: LinkInfo[];
  timestamp: number;
  hasModal?: boolean;
  modalHint?: string;
}

export interface FormInfo {
  index: number;
  action: string;
  method: string;
  fields: FormField[];
}

export interface FormField {
  name: string;
  type: string;
  placeholder?: string;
  value?: string;
  required: boolean;
  selector: string;
}

export interface LinkInfo {
  index: number;
  text: string;
  href: string;
  selector: string;
}

export interface BrowserAction {
  type: 'click' | 'type_text' | 'navigate' | 'scroll' | 'wait' | 'screenshot' | 'select' | 'hover' | 'press_key' | 'go_back' | 'go_forward' | 'refresh' | 'extract_text';
  selector?: string;
  value?: string;
  text?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
  key?: string;
  maxLength?: number;
}

export interface AgentThought {
  reasoning: string;
  action: BrowserAction | null;
  needsUserInput: boolean;
  userQuestion?: string;
  isComplete: boolean;
  result?: string;
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface SecurityCheck {
  action: BrowserAction;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  requiresConfirmation: boolean;
}

export type BrowserTypeOption = 'chromium' | 'chrome' | 'yandex' | 'firefox' | 'edge';

export interface AgentConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  maxIterations: number;
  browserHeadless: boolean;
  browserSlowMo: number;
  userDataDir: string;
  browserType: BrowserTypeOption;
  customBrowserPath?: string;
}

export interface TaskResult {
  success: boolean;
  summary: string;
  actions: BrowserAction[];
  errors: string[];
  duration: number;
}
