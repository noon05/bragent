import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { BrowserController } from '../browser/controller.js';
import { ContextManager } from '../context/manager.js';
import { SecurityLayer } from '../security/layer.js';
import { 
  BrowserAction, 
  AgentThought, 
  ConversationMessage,
  PageContext,
  AgentConfig,
  TaskResult
} from '../types/index.js';

// Тип для функций управления браузером через расширение
type ExtensionExecutor = (type: string, data?: any) => Promise<any>;

// Определение инструментов для AI
const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Перейти по указанному URL адресу',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL адрес для перехода (должен начинаться с http:// или https://)'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Кликнуть на элемент на странице. Используй селектор из списка интерактивных элементов.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS селектор элемента для клика'
          },
          description: {
            type: 'string',
            description: 'Описание элемента, на который кликаем (для логирования)'
          }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'click_text',
      description: 'Кликнуть на элемент по тексту. Используй когда точный селектор неизвестен, но знаешь текст кнопки.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Текст кнопки или ссылки для клика (например "Удалить все письма со спамом")'
          }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Ввести текст в поле ввода. Сначала очистит поле, затем введёт текст.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS селектор поля ввода'
          },
          text: {
            type: 'string',
            description: 'Текст для ввода'
          }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Прокрутить страницу вверх или вниз',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down'],
            description: 'Направление прокрутки'
          },
          amount: {
            type: 'number',
            description: 'Количество пикселей для прокрутки (по умолчанию 500)'
          }
        },
        required: ['direction']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Нажать клавишу на клавиатуре (Enter, Escape, Tab, и т.д.)',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Название клавиши (Enter, Escape, Tab, ArrowDown, ArrowUp, и т.д.)'
          }
        },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'hover',
      description: 'Навести курсор на элемент (для выпадающих меню)',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS селектор элемента'
          }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Подождать указанное время (для загрузки динамического контента)',
      parameters: {
        type: 'object',
        properties: {
          milliseconds: {
            type: 'number',
            description: 'Время ожидания в миллисекундах'
          }
        },
        required: ['milliseconds']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'go_back',
      description: 'Вернуться на предыдущую страницу в истории браузера',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'refresh',
      description: 'Обновить текущую страницу',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'select_option',
      description: 'Выбрать опцию в выпадающем списке (select)',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS селектор select элемента'
          },
          value: {
            type: 'string',
            description: 'Значение опции для выбора'
          }
        },
        required: ['selector', 'value']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'ТОЛЬКО для запроса ЛИЧНЫХ данных (адрес, телефон, логин, пароль) или уточнения непонятной задачи. НИКОГДА не спрашивай как найти элемент на странице - это твоя работа!',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Вопрос для пользователя (ТОЛЬКО личные данные или уточнение задачи!)'
          }
        },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'confirm_action',
      description: 'Запросить подтверждение у пользователя перед важным действием (удаление, оплата, отправка и т.п.). Покажет кнопки Да/Нет.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Вопрос для подтверждения, например "Удалить 3 письма из спама?"'
          },
          action_description: {
            type: 'string',
            description: 'Краткое описание действия для кнопки'
          }
        },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Завершить выполнение задачи и сообщить результат. Используй summary чтобы передать пользователю извлечённую информацию.',
      parameters: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            description: 'Успешно ли выполнена задача'
          },
          summary: {
            type: 'string',
            description: 'ПОЛНЫЙ ответ для пользователя. Если задача требовала найти информацию - включи её сюда целиком.'
          }
        },
        required: ['success', 'summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'extract_text',
      description: 'Извлечь и вернуть текст со страницы по селектору или весь видимый текст. Используй когда пользователь просит показать/прочитать контент.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS селектор элемента для извлечения текста. Если не указан - извлекает основной контент страницы.'
          },
          maxLength: {
            type: 'number',
            description: 'Максимальная длина текста (по умолчанию 2000 символов)'
          }
        },
        required: []
      }
    }
  }
];

const SYSTEM_PROMPT = `Ты — умный браузерный агент. Выполняй любые задачи, самостоятельно анализируя страницу.

## Инструменты:
- navigate: перейти по URL
- click: клик по CSS селектору ИЗ СПИСКА элементов
- click_text: клик по видимому тексту элемента
- type_text: ввести текст в поле
- scroll: прокрутить страницу чтобы увидеть больше элементов
- press_key: нажать клавишу (Enter, Escape, Tab и др.)
- extract_text: извлечь текст со страницы
- ask_user: спросить у пользователя ЛИЧНЫЕ данные (адрес, телефон, пароль)
- complete_task: завершить задачу с отчётом

## Как работать:
1. АНАЛИЗИРУЙ контекст страницы - там список всех видимых элементов
2. ОПРЕДЕЛИ что нужно сделать для достижения цели
3. ВЫБЕРИ подходящий элемент из списка и действие
4. ПОВТОРЯЙ пока задача не выполнена

## Правила:
- Используй ТОЛЬКО селекторы из списка элементов на странице
- Если нужного элемента нет - прокрути страницу (scroll)
- Не повторяй неудавшиеся действия - попробуй другой подход
- Если открылось модальное окно - работай с его элементами
- После ввода в поисковое поле обычно нужен Enter
- ask_user ТОЛЬКО для личных данных, не для "как сделать X"

## Завершение:
- complete_task когда цель достигнута
- complete_task с объяснением если задача невыполнима
`;


const ANTHROPIC_TOOLS: Anthropic.Tool[] = TOOLS.map(tool => ({
  name: tool.function.name,
  description: tool.function.description,
  input_schema: tool.function.parameters as Anthropic.Tool.InputSchema
}));

export class AIAgent {
  private client: OpenAI | null = null;
  private anthropicClient: Anthropic | null = null;
  private isAnthropic: boolean = false;
  private browserController: BrowserController | null = null;
  private contextManager: ContextManager;
  private securityLayer: SecurityLayer;
  private conversationHistory: ConversationMessage[] = [];
  private model: string;
  private maxIterations: number;
  private currentTask: string = '';
  private actionsLog: BrowserAction[] = [];
  private consecutiveErrors: number = 0;
  private recentActions: string[] = []; // Отслеживаем последние действия для обнаружения циклов
  private onLog: (message: string, type: 'info' | 'action' | 'thought' | 'error' | 'success' | 'warning' | 'confirm') => void;
  private onSecurityPrompt: (warning: string) => Promise<boolean>;
  private onUserInput: (question: string) => Promise<string>;
  private extensionExecutor: ExtensionExecutor | null = null;
  private useExtension: boolean = false;
  private config: AgentConfig;

  constructor(
    config: AgentConfig,
    callbacks: {
      onLog: (message: string, type: 'info' | 'action' | 'thought' | 'error' | 'success' | 'warning' | 'confirm') => void;
      onSecurityPrompt: (warning: string) => Promise<boolean>;
      onUserInput: (question: string) => Promise<string>;
    },
    extensionExecutor?: ExtensionExecutor
  ) {
    this.config = config;
    
    // Определяем провайдера по модели
    const isZhipuAI = config.model.startsWith('zhipu/');
    const isG4F = config.model.startsWith('g4f/');
    const isGemini = config.model.startsWith('gemini/');
    const isGroq = config.model.startsWith('groq/');
    this.isAnthropic = config.model.startsWith('claude/');
    
    if (this.isAnthropic) {
      // Anthropic (Claude) - нативный SDK
      this.anthropicClient = new Anthropic({
        apiKey: config.apiKey
      });
      // Убираем префикс claude/ для API вызова
      this.model = config.model.replace('claude/', '');
    } else if (isGemini) {
      // Google Gemini - БЕСПЛАТНО! 15 RPM
      // Получи ключ: https://aistudio.google.com/apikey
      this.client = new OpenAI({
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: config.apiKey
      });
      // Убираем префикс gemini/ для API вызова
      this.model = config.model.replace('gemini/', '');
    } else if (isGroq) {
      // Groq - БЕСПЛАТНО! Очень быстрый
      // Получи ключ: https://console.groq.com/keys
      this.client = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: config.apiKey
      });
      // Убираем префикс groq/ для API вызова
      this.model = config.model.replace('groq/', '');
    } else if (isG4F) {
      // GPT4Free - локальный OpenAI-совместимый API (БЕСПЛАТНО!)
      // Запусти: pip install g4f[all] && python -m g4f.cli api --port 8080
      this.client = new OpenAI({
        baseURL: 'http://127.0.0.1:8080/v1', // Используем 127.0.0.1 вместо localhost для избежания IPv6
        apiKey: 'not-needed' // g4f не требует API ключ
      });
      // Убираем префикс g4f/ для API вызова
      this.model = config.model.replace('g4f/', '');
    } else if (isZhipuAI) {
      // ZhipuAI (GLM) - OpenAI-совместимый API
      this.client = new OpenAI({
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: config.apiKey
      });
      // Убираем префикс zhipu/ для API вызова
      this.model = config.model.replace('zhipu/', '');
    } else {
      // OpenRouter
      this.client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: config.apiKey,
        defaultHeaders: {
          'HTTP-Referer': 'https://github.com/bragent',
          'X-Title': 'Bragent - AI Browser Agent'
        }
      });
      this.model = config.model;
    }

    this.maxIterations = config.maxIterations;
    
    // Определяем режим работы
    this.useExtension = ['yandex', 'chrome', 'edge'].includes(config.browserType || 'chromium');
    this.extensionExecutor = extensionExecutor || null;
    
    // Создаём BrowserController только если не используем расширение
    if (!this.useExtension) {
      this.browserController = new BrowserController(
        config.userDataDir,
        config.browserHeadless,
        config.browserSlowMo,
        config.browserType,
        config.customBrowserPath
      );
    }
    
    this.contextManager = new ContextManager(8000);
    this.securityLayer = new SecurityLayer();
    
    this.onLog = callbacks.onLog;
    this.onSecurityPrompt = callbacks.onSecurityPrompt;
    this.onUserInput = callbacks.onUserInput;
  }

  // Установить executor для работы через расширение
  setExtensionExecutor(executor: ExtensionExecutor): void {
    this.extensionExecutor = executor;
  }

  // Ограничить историю разговора чтобы модель не путалась
  private trimConversationHistory(maxMessages: number): void {
    // Находим системное сообщение
    const systemMsg = this.conversationHistory.find(m => m.role === 'system');
    
    // Берём только последние N сообщений (не считая system)
    const nonSystemMessages = this.conversationHistory.filter(m => m.role !== 'system');
    
    if (nonSystemMessages.length > maxMessages) {
      // Оставляем только последние maxMessages
      let trimmedMessages = nonSystemMessages.slice(-maxMessages);
      
      // ВАЖНО: Убеждаемся что первое сообщение - не tool (нужен assistant с tool_calls перед ним)
      // И что история начинается с user, не с assistant или tool
      while (trimmedMessages.length > 0 && 
             (trimmedMessages[0].role === 'tool' || trimmedMessages[0].role === 'assistant')) {
        trimmedMessages = trimmedMessages.slice(1);
      }
      
      // Пересобираем историю
      this.conversationHistory = [];
      if (systemMsg) {
        this.conversationHistory.push(systemMsg);
      }
      this.conversationHistory.push(...trimmedMessages);
      
      console.log(`[History] Trimmed to ${this.conversationHistory.length} messages`);
    }
  }

  async initialize(): Promise<void> {
    if (this.useExtension) {
      this.onLog('Режим работы: через браузерное расширение', 'info');
      // Ничего не инициализируем - ждём подключения расширения
    } else {
      this.onLog('Инициализация браузера...', 'info');
      await this.browserController!.initialize();
      this.onLog('Браузер запущен!', 'success');
    }
  }

  async close(): Promise<void> {
    if (this.browserController) {
      await this.browserController.close();
    }
  }

  // Выполнить действие (через Playwright или расширение)
  private async executeAction(action: BrowserAction): Promise<string> {
    if (this.useExtension && this.extensionExecutor) {
      const result = await this.extensionExecutor('EXECUTE_ACTION', { action });
      if (!result) {
        throw new Error('Нет ответа от расширения');
      }
      if (!result.success) {
        throw new Error(result.error || 'Ошибка выполнения действия');
      }
      return result.message || 'OK';
    } else if (this.browserController) {
      return await this.browserController.executeAction(action);
    } else {
      throw new Error('Нет доступного способа управления браузером');
    }
  }

  // Получить контекст страницы (через Playwright или расширение)
  private async getPageContext(): Promise<PageContext> {
    if (this.useExtension && this.extensionExecutor) {
      const result = await this.extensionExecutor('GET_PAGE_CONTEXT');
      
      // Проверяем что result существует
      if (!result) {
        return {
          url: '',
          title: '',
          elements: [],
          textContent: '',
          forms: [],
          links: [],
          timestamp: Date.now()
        };
      }
      
      return {
        url: result.url || '',
        title: result.title || '',
        elements: Array.isArray(result.elements) ? result.elements.map((el: any, idx: number) => ({
          index: el.index ?? idx,
          tag: el.tag || '',
          text: el.text || '',
          selector: el.selector || '',
          type: el.type || '',
          attributes: el.attributes || {}
        })) : [],
        textContent: result.textContent || '',
        forms: Array.isArray(result.forms) ? result.forms : [],
        links: [],
        timestamp: Date.now(),
        hasModal: result.hasModal || false,
        modalHint: result.modalHint || undefined
      };
    } else if (this.browserController) {
      return await this.browserController.extractPageContext();
    } else {
      throw new Error('Нет доступного способа получения контекста страницы');
    }
  }

  async executeTask(task: string): Promise<TaskResult> {
    const startTime = Date.now();
    this.currentTask = task;
    this.actionsLog = [];
    this.conversationHistory = [];
    this.consecutiveErrors = 0;
    this.recentActions = []; // Сбрасываем историю действий для обнаружения циклов

    // Добавляем системный промпт
    this.conversationHistory.push({
      role: 'system',
      content: SYSTEM_PROMPT
    });

    // Добавляем задачу пользователя
    this.conversationHistory.push({
      role: 'user',
      content: `Задача: ${task}\n\nПроанализируй текущее состояние страницы и начни выполнение.`
    });

    let iteration = 0;
    let isComplete = false;
    let taskResult: TaskResult = {
      success: false,
      summary: 'Задача не завершена',
      actions: [],
      errors: [],
      duration: 0
    };

    while (iteration < this.maxIterations && !isComplete) {
      iteration++;
      console.log(`\n=== ITERATION ${iteration}/${this.maxIterations} ===`);
      this.onLog(`--- Итерация ${iteration}/${this.maxIterations} ---`, 'info');

      try {
        // Получаем контекст текущей страницы
        console.log('[DEBUG] Getting page context...');
        const pageContext = await this.getPageContext();
        console.log('[DEBUG] Got context, formatting...');
        let formattedContext: string;
        try {
          formattedContext = this.contextManager.formatContextForAI(pageContext);
          console.log('[DEBUG] Formatted context length:', formattedContext.length);
        } catch (formatError) {
          console.error('[DEBUG] Format error:', formatError);
          formattedContext = `URL: ${pageContext.url}\nTitle: ${pageContext.title}`;
        }

        // Формируем краткий лог выполненных действий
        const recentActions = this.actionsLog.slice(-5).map((a, i) => {
          if (a.type === 'navigate') return `${i+1}. navigate -> ${a.url}`;
          if (a.type === 'click') return `${i+1}. click -> ${a.selector}`;
          if (a.type === 'type_text') return `${i+1}. type_text -> "${a.text}" в ${a.selector}`;
          if (a.type === 'scroll') return `${i+1}. scroll ${a.direction}`;
          return `${i+1}. ${a.type}`;
        }).join('\n');
        
        const actionsContext = recentActions ? `\n\n--- Последние действия ---\n${recentActions}` : '';

        // Добавляем контекст страницы С НАПОМИНАНИЕМ О ЗАДАЧЕ
        console.log('[DEBUG] Adding user message to history, task:', task?.slice(0, 50));
        this.conversationHistory.push({
          role: 'user',
          content: `[ЗАДАЧА: ${task}]${actionsContext}\n\n--- Состояние страницы ---\n${formattedContext}\n\nПродолжай выполнять задачу: "${task}". НЕ ПОВТОРЯЙ действия которые уже выполнены!`
        });
        console.log('[DEBUG] Message added to history');

        // ВАЖНО: Ограничиваем историю чтобы модель не путалась
        // Оставляем только: system + последние 12 сообщений
        console.log('[DEBUG] History before trim:', this.conversationHistory.length, 'messages');
        console.log('[DEBUG] History roles:', this.conversationHistory.map(m => m.role).join(', '));
        this.trimConversationHistory(12);
        console.log('[DEBUG] History after trim:', this.conversationHistory.length, 'messages');
        console.log('[DEBUG] History roles after trim:', this.conversationHistory.map(m => m.role).join(', '));

        // Отправляем запрос к AI
        console.log('[DEBUG] Calling AI...');
        const response = await this.callAI();
        
        if (!response) {
          this.onLog('AI не ответил (null response)', 'error');
          // Попробуем очистить историю и начать заново
          this.conversationHistory = this.conversationHistory.filter(m => m.role === 'system');
          this.conversationHistory.push({
            role: 'user',
            content: `Задача: ${task}\n\nТекущая страница: ${pageContext.url}\nПродолжай выполнять задачу.`
          });
          continue;
        }

        // Обрабатываем ответ
        const thought = response.choices[0]?.message;
        
        // Логируем ответ AI для отладки
        console.log('[AI Response]', JSON.stringify({
          content: thought?.content?.slice(0, 200),
          tool_calls: thought?.tool_calls?.map(tc => ({ name: tc.function?.name, args: tc.function?.arguments?.slice(0, 100) }))
        }));
        
        // Выводим content только если НЕТ tool_calls (чтобы не дублировать)
        const hasToolCalls = thought?.tool_calls && thought.tool_calls.length > 0;
        if (thought?.content && !hasToolCalls) {
          this.onLog(thought.content, 'thought');
        }

        // Проверяем вызовы инструментов
        if (hasToolCalls && thought?.tool_calls) {
          // ВАЖНО: Сначала добавляем полное сообщение assistant с tool_calls
          this.conversationHistory.push({
            role: 'assistant',
            content: thought.content || null,
            tool_calls: thought.tool_calls
          } as any);

          // Теперь обрабатываем каждый tool_call и добавляем результаты
          for (const toolCall of thought.tool_calls) {
            // Проверяем на повторяющиеся действия (цикл)
            // Используем полную сигнатуру действия (тип + селектор) для точного определения цикла
            const actionName = toolCall.function?.name || 'unknown';
            let args: any = {};
            try {
              args = JSON.parse(toolCall.function?.arguments || '{}');
            } catch {}
            
            // Для click и type_text используем селектор для уникальности
            // Клики на разные элементы - это не цикл!
            const actionSignature = args.selector 
              ? `${actionName}:${args.selector.substring(0, 50)}` 
              : actionName;
            
            this.recentActions.push(actionSignature);
            if (this.recentActions.length > 10) this.recentActions.shift();
            
            // Считаем сколько раз ТОЧНО ТАКОЕ ЖЕ действие повторялось
            const repeatCount = this.recentActions.filter(a => a === actionSignature).length;
            
            // Если одно и то же действие (с тем же селектором) повторяется 4+ раза - застряли
            const isSameActionLoop = repeatCount >= 4;
            
            // Проверяем паттерн чередования (Escape -> тот же клик -> Escape -> тот же клик)
            const last4 = this.recentActions.slice(-4);
            const isAlternatingLoop = last4.length === 4 && 
              last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1];
            
            if (isSameActionLoop || isAlternatingLoop) {
              this.onLog(`⚠️ Обнаружен цикл действий. Завершаю задачу.`, 'warning');
              isComplete = true;
              taskResult = {
                success: false,
                summary: `Задача не выполнена - агент застрял в цикле (повторяющееся действие: "${actionName}"). Возможно, нужно закрыть модальное окно вручную или уточнить задачу.`,
                actions: this.actionsLog,
                errors: ['Обнаружен цикл действий'],
                duration: Date.now() - startTime
              };
              break;
            }
            
            const result = await this.executeToolCall(toolCall, pageContext);
            
            // Считаем последовательные ошибки
            if (result.result.includes('Ошибка') || result.result.includes('не найден') || result.result.includes('not a valid selector')) {
              this.consecutiveErrors++;
              console.log(`[DEBUG] Consecutive errors: ${this.consecutiveErrors}`);
              
              // После 3 ошибок подряд - добавляем подсказку
              if (this.consecutiveErrors >= 3) {
                result.result += '\n\n⚠️ МНОГО ОШИБОК! Используй ТОЛЬКО селекторы из списка элементов. Если нужного элемента нет - вызови complete_task с объяснением.';
              }
              
              // После 5 ошибок - принудительно завершаем
              if (this.consecutiveErrors >= 5) {
                this.onLog('⚠️ Слишком много ошибок подряд, завершаю задачу', 'warning');
                isComplete = true;
                taskResult = {
                  success: false,
                  summary: 'Не удалось выполнить задачу - слишком много ошибок. Попробуйте сформулировать задачу иначе.',
                  actions: this.actionsLog,
                  errors: ['Превышен лимит ошибок'],
                  duration: Date.now() - startTime
                };
                break;
              }
            } else {
              this.consecutiveErrors = 0;
            }
            
            // Добавляем результат инструмента
            this.conversationHistory.push({
              role: 'tool',
              content: result.result,
              tool_call_id: toolCall.id
            } as any);

            if (result.isComplete) {
              isComplete = true;
              taskResult = {
                success: result.success || false,
                summary: result.summary || 'Задача завершена',
                actions: this.actionsLog,
                errors: [],
                duration: Date.now() - startTime
              };
              break;
            }

            if (result.needsUserInput) {
              // Ждём ввод пользователя
              const userResponse = await this.onUserInput(result.question || 'Нужна информация');
              this.conversationHistory.push({
                role: 'user',
                content: userResponse
              });
            }
          }
        } else {
          // AI не вызвал инструменты, просто продолжаем
          this.conversationHistory.push({
            role: 'assistant',
            content: thought?.content || 'Думаю...'
          });
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.onLog(`Ошибка: ${errorMsg}`, 'error');
        taskResult.errors.push(errorMsg);
        
        // Добавляем ошибку в контекст
        this.conversationHistory.push({
          role: 'user',
          content: `Произошла ошибка: ${errorMsg}. Попробуй другой подход.`
        });
      }
    }

    if (!isComplete) {
      taskResult.summary = `Достигнут лимит итераций (${this.maxIterations})`;
    }

    taskResult.duration = Date.now() - startTime;
    return taskResult;
  }

  // Универсальный формат ответа для обоих API
  private async callAI(): Promise<OpenAI.ChatCompletion | null> {
    try {
      this.onLog(`Отправляю запрос к ${this.model}...`, 'info');
      
      if (this.isAnthropic && this.anthropicClient) {
        // Anthropic API
        const systemMessage = this.conversationHistory.find(m => m.role === 'system');
        const messages = this.conversationHistory
          .filter(m => m.role !== 'system')
          .map(m => {
            if (m.role === 'assistant' && m.tool_calls) {
              // Конвертируем tool_calls в формат Anthropic
              const content: any[] = [];
              if (m.content) {
                content.push({ type: 'text', text: m.content });
              }
              for (const tc of m.tool_calls) {
                content.push({
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function.name,
                  input: JSON.parse(tc.function.arguments)
                });
              }
              return { role: 'assistant' as const, content };
            } else if (m.role === 'tool') {
              return {
                role: 'user' as const,
                content: [{
                  type: 'tool_result' as const,
                  tool_use_id: m.tool_call_id,
                  content: m.content || ''
                }]
              };
            } else {
              return {
                role: m.role as 'user' | 'assistant',
                content: m.content || ''
              };
            }
          });

        const response = await this.anthropicClient.messages.create({
          model: this.model,
          max_tokens: 400,
          temperature: 0.1,
          system: systemMessage?.content || SYSTEM_PROMPT,
          tools: ANTHROPIC_TOOLS,
          messages: messages as any
        });

        // Конвертируем ответ Anthropic в формат OpenAI
        const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];
        let textContent = '';

        for (const block of response.content) {
          if (block.type === 'text') {
            textContent += block.text;
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input)
              }
            });
          }
        }

        // Формируем ответ в формате OpenAI
        const openAIResponse: OpenAI.ChatCompletion = {
          id: response.id,
          object: 'chat.completion',
          created: Date.now(),
          model: response.model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: textContent || null,
              tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
              refusal: null
            },
            finish_reason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
            logprobs: null
          }],
          usage: {
            prompt_tokens: response.usage.input_tokens,
            completion_tokens: response.usage.output_tokens,
            total_tokens: response.usage.input_tokens + response.usage.output_tokens
          }
        };

        return openAIResponse;
      } else if (this.client) {
        // OpenAI-совместимый API (OpenRouter, ZhipuAI)
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: this.conversationHistory as any,
          tools: TOOLS,
          tool_choice: 'auto',
          max_tokens: 400,
          temperature: 0.1
        });

        return response;
      }
      
      return null;
    } catch (error: any) {
      // ПОЛНОЕ логирование ошибки
      console.error('=== FULL API ERROR ===');
      console.error(JSON.stringify(error, null, 2));
      console.error('=== END ERROR ===');
      
      // Пробуем извлечь максимум информации
      let errorDetails = '';
      
      // OpenAI SDK ошибки
      if (error?.status) {
        errorDetails += `Status: ${error.status}. `;
      }
      if (error?.error) {
        errorDetails += `Error: ${JSON.stringify(error.error)}. `;
      }
      if (error?.message) {
        errorDetails += `Message: ${error.message}. `;
      }
      if (error?.code) {
        errorDetails += `Code: ${error.code}. `;
      }
      
      // Axios-style ошибки
      if (error?.response?.status) {
        errorDetails += `Response Status: ${error.response.status}. `;
      }
      if (error?.response?.data) {
        errorDetails += `Response Data: ${JSON.stringify(error.response.data)}. `;
      }
      
      // Если ничего не нашли
      if (!errorDetails) {
        errorDetails = String(error);
      }
      
      this.onLog(`Ошибка API: ${errorDetails}`, 'error');
      
      // Если это rate limit (429) - ждём и пробуем снова
      if (error?.status === 429 || errorDetails.includes('429') || errorDetails.includes('rate') || errorDetails.includes('limit')) {
        this.onLog('⏳ Rate limit! Ждём 5 секунд...', 'warning');
        await new Promise(resolve => setTimeout(resolve, 5000));
        // Не возвращаем null - пусть retry произойдёт на следующей итерации
      }
      
      // Если это ошибка контекста, уменьшаем его
      if (errorDetails.includes('context') || errorDetails.includes('token') || errorDetails.includes('length')) {
        this.onLog('Попытка уменьшить контекст...', 'warning');
        if (this.conversationHistory.length > 12) {
          const systemPrompt = this.conversationHistory[0];
          const recentMessages = this.conversationHistory.slice(-10);
          this.conversationHistory = [systemPrompt, ...recentMessages];
        }
      }
      
      return null;
    }
  }

  private async executeToolCall(
    toolCall: OpenAI.ChatCompletionMessageToolCall,
    pageContext: PageContext
  ): Promise<{
    result: string;
    isComplete: boolean;
    success?: boolean;
    summary?: string;
    needsUserInput?: boolean;
    question?: string;
    isConfirmation?: boolean;
  }> {
    const functionName = toolCall.function.name;
    let args: any;
    
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return { result: 'Ошибка парсинга аргументов', isComplete: false };
    }

    // Не логируем complete_task как action - результат покажется в taskComplete
    if (functionName !== 'complete_task') {
      this.onLog(`🔧 ${functionName}: ${JSON.stringify(args)}`, 'action');
    }

    try {
      switch (functionName) {
        case 'navigate': {
          const action: BrowserAction = { type: 'navigate', url: args.url };
          const securityCheck = this.securityLayer.checkAction(action, { url: pageContext.url });
          
          if (securityCheck.requiresConfirmation) {
            const confirmed = await this.onSecurityPrompt(
              this.securityLayer.formatWarning(securityCheck)
            );
            if (!confirmed) {
              return { result: 'Действие отменено пользователем', isComplete: false };
            }
          }
          
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'click': {
          // Находим текст элемента для проверки безопасности
          const element = pageContext.elements.find(el => el.selector === args.selector);
          const action: BrowserAction = { type: 'click', selector: args.selector };
          const securityCheck = this.securityLayer.checkAction(action, { 
            url: pageContext.url,
            elementText: element?.text || args.description || ''
          });
          
          if (securityCheck.requiresConfirmation) {
            const confirmed = await this.onSecurityPrompt(
              this.securityLayer.formatWarning(securityCheck)
            );
            if (!confirmed) {
              return { result: 'Действие отменено пользователем', isComplete: false };
            }
          }
          
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'click_text': {
          // Клик по тексту - создаём специальный селектор
          this.onLog(`🖱️ Клик по тексту: "${args.text}"`, 'action');
          const action: BrowserAction = { 
            type: 'click', 
            selector: `text:${args.text}` // специальный формат для content.js
          };
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'type_text': {
          const action: BrowserAction = { type: 'type_text', selector: args.selector, text: args.text };
          const securityCheck = this.securityLayer.checkAction(action, { url: pageContext.url });
          
          if (securityCheck.requiresConfirmation) {
            const confirmed = await this.onSecurityPrompt(
              this.securityLayer.formatWarning(securityCheck)
            );
            if (!confirmed) {
              return { result: 'Действие отменено пользователем', isComplete: false };
            }
          }
          
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'scroll': {
          const action: BrowserAction = { 
            type: 'scroll', 
            direction: args.direction, 
            amount: args.amount || 500 
          };
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'press_key': {
          const action: BrowserAction = { type: 'press_key', key: args.key };
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'hover': {
          const action: BrowserAction = { type: 'hover', selector: args.selector };
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'wait': {
          const action: BrowserAction = { type: 'wait', amount: args.milliseconds };
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'go_back': {
          const action: BrowserAction = { type: 'go_back' };
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'refresh': {
          const action: BrowserAction = { type: 'refresh' };
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'select_option': {
          const action: BrowserAction = { 
            type: 'select', 
            selector: args.selector, 
            value: args.value 
          };
          const result = await this.executeAction(action);
          this.actionsLog.push(action);
          return { result, isComplete: false };
        }

        case 'ask_user': {
          this.onLog(`❓ ${args.question}`, 'warning');
          return { 
            result: 'Ожидаю ответа пользователя...', 
            isComplete: false,
            needsUserInput: true,
            question: args.question
          };
        }

        case 'confirm_action': {
          // Отправляем запрос подтверждения с кнопками
          this.onLog(`⚠️ ПОДТВЕРЖДЕНИЕ: ${args.question}`, 'confirm');
          return { 
            result: 'Ожидаю подтверждения пользователя...', 
            isComplete: false,
            needsUserInput: true,
            question: args.question,
            isConfirmation: true
          };
        }

        case 'extract_text': {
          this.onLog(`📄 Извлекаю текст со страницы...`, 'action');
          const action: BrowserAction = { 
            type: 'extract_text', 
            selector: args.selector,
            maxLength: args.maxLength || 2000
          };
          const extractResult = await this.executeAction(action) as any;
          
          // Показываем извлечённый текст пользователю
          if (extractResult.success && extractResult.text) {
            this.onLog(`📋 Контент:\n${extractResult.text}`, 'info');
          }
          
          return { result: extractResult.text || extractResult.error || 'Не удалось извлечь текст', isComplete: false };
        }

        case 'complete_task': {
          // НЕ вызываем onLog здесь - summary покажется в taskComplete событии
          return { 
            result: args.summary, 
            isComplete: true,
            success: args.success,
            summary: args.summary
          };
        }

        default:
          return { result: `Неизвестный инструмент: ${functionName}`, isComplete: false };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.onLog(`Ошибка выполнения ${functionName}: ${errorMsg}`, 'error');
      return { result: `Ошибка: ${errorMsg}`, isComplete: false };
    }
  }

  getBrowserController(): BrowserController | null {
    return this.browserController;
  }
}
