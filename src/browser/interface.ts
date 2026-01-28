import { BrowserAction, PageContext } from '../types/index.js';

/**
 * Интерфейс для контроллеров браузера
 * Позволяет использовать разные способы управления браузером
 */
export interface IBrowserController {
  executeAction(action: BrowserAction): Promise<string>;
  extractPageContext(): Promise<PageContext>;
  close(): Promise<void>;
}
