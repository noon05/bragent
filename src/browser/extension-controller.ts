import { WebSocket, WebSocketServer } from 'ws';
import { BrowserAction, PageContext, PageElement, FormInfo, LinkInfo } from '../types/index.js';

/**
 * ExtensionBrowserController - управление браузером через расширение
 * Браузер запускается обычным способом, расширение подключается через WebSocket
 */
export class ExtensionBrowserController {
  private wss: WebSocketServer | null = null;
  private extensionSocket: WebSocket | null = null;
  private pendingRequests: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();
  private requestId = 0;
  private isConnected = false;

  constructor() {}

  // Запуск WebSocket сервера
  startServer(server: any): void {
    this.wss = new WebSocketServer({ server, path: '/extension' });
    
    this.wss.on('connection', (ws) => {
      console.log('🔌 Расширение подключено!');
      this.extensionSocket = ws;
      this.isConnected = true;

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleResponse(message);
        } catch (e) {
          console.error('Ошибка парсинга сообщения от расширения:', e);
        }
      });

      ws.on('close', () => {
        console.log('🔌 Расширение отключено');
        this.extensionSocket = null;
        this.isConnected = false;
      });

      ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
      });
    });
  }

  private handleResponse(message: { id: string; result: any }) {
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(message.result);
      this.pendingRequests.delete(message.id);
    }
  }

  // Отправка команды расширению и ожидание ответа
  private async sendCommand(type: string, data: any = {}, timeoutMs: number = 30000): Promise<any> {
    if (!this.extensionSocket || !this.isConnected) {
      throw new Error('Расширение не подключено. Установите расширение Bragent в браузере.');
    }

    return new Promise((resolve, reject) => {
      const id = `req_${++this.requestId}`;
      
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Таймаут ожидания ответа от расширения'));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.extensionSocket!.send(JSON.stringify({
        id,
        type,
        ...data
      }));
    });
  }

  // Проверка подключения
  async waitForConnection(timeoutMs: number = 60000): Promise<void> {
    const startTime = Date.now();
    
    while (!this.isConnected) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Расширение не подключилось. Убедитесь что расширение Bragent установлено и браузер открыт.');
      }
      await new Promise(r => setTimeout(r, 1000));
      
      if ((Date.now() - startTime) % 10000 < 1000) {
        console.log('⏳ Ожидание подключения расширения...');
      }
    }
  }

  isExtensionConnected(): boolean {
    return this.isConnected;
  }

  // ==================== Действия браузера ====================

  async executeAction(action: BrowserAction): Promise<string> {
    const result = await this.sendCommand('EXECUTE_ACTION', { action });
    
    if (!result.success) {
      throw new Error(result.error || 'Ошибка выполнения действия');
    }
    
    return result.message || 'OK';
  }

  async extractPageContext(): Promise<PageContext> {
    const result = await this.sendCommand('GET_PAGE_CONTEXT');
    
    if (!result.success) {
      return {
        url: result.url || '',
        title: result.title || '',
        elements: [],
        textContent: '',
        forms: [],
        links: [],
        timestamp: Date.now()
      };
    }

    // Преобразуем элементы в нужный формат
    const elements: PageElement[] = (result.elements || []).map((el: any) => ({
      tag: el.tag,
      text: el.text || '',
      selector: el.selector,
      type: el.type,
      attributes: {}
    }));

    const forms: FormInfo[] = (result.forms || []).map((f: any) => ({
      action: f.action || '',
      method: f.method || 'GET',
      fields: (f.inputs || []).map((i: any) => ({
        name: i.name || '',
        type: i.type || 'text',
        placeholder: i.placeholder || '',
        required: false,
        value: i.value || '',
        selector: `[name="${i.name}"]`
      }))
    }));

    return {
      url: result.url || '',
      title: result.title || '',
      elements,
      textContent: result.textContent || '',
      forms,
      links: [],
      timestamp: Date.now()
    };
  }

  async takeScreenshot(): Promise<Buffer | null> {
    // Скриншоты не поддерживаются через расширение стандартным способом
    console.log('⚠️ Скриншоты недоступны в режиме расширения');
    return null;
  }

  async close(): Promise<void> {
    if (this.wss) {
      this.wss.close();
    }
  }
}
