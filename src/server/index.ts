import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { AIAgent } from '../agent/core.js';
import { AgentConfig, TaskResult } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WebSocketClient {
  send: (data: string) => void;
}

/**
 * WebServer - веб-интерфейс для Bragent
 * Теперь поддерживает управление через браузерное расширение
 */
export class WebServer {
  private agent: AIAgent | null = null;
  private clients: Set<WebSocketClient> = new Set();
  private logs: Array<{ time: string; type: string; message: string }> = [];
  private isRunning = false;
  private currentTask = '';
  private config: AgentConfig;
  private httpServer: Server | null = null;
  private extensionWs: WebSocketServer | null = null;
  private extensionSocket: WebSocket | null = null;
  private pendingRequests: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();
  private requestId = 0;
  private pendingSecurityPrompt: {
    resolve: (value: boolean) => void;
    warning: string;
  } | null = null;
  private pendingUserInput: {
    resolve: (value: string) => void;
    question: string;
  } | null = null;
  private useExtension: boolean = true; // Новый режим - через расширение
  
  // Long-polling для расширения
  private extensionPollResolve: ((command: any) => void) | null = null;
  private extensionConnected: boolean = false;
  private pendingCommand: { id: string; type: string; [key: string]: any } | null = null;
  private commandResults: Map<string, any> = new Map();
  private commandId = 0;

  constructor(config: AgentConfig) {
    this.config = config;
    // По умолчанию используем расширение для yandex/chrome/edge
    this.useExtension = ['yandex', 'chrome', 'edge'].includes(config.browserType || 'chromium');
  }

  private broadcast(event: string, data: any) {
    const message = JSON.stringify({ event, data });
    console.log(`[Broadcast] ${event} to ${this.clients.size} clients:`, data);
    this.clients.forEach(client => {
      try {
        client.send(message);
      } catch (e) {
        this.clients.delete(client);
      }
    });
  }

  private log(message: string, type: 'info' | 'action' | 'thought' | 'error' | 'success' | 'warning' | 'confirm') {
    const logEntry = {
      time: new Date().toLocaleTimeString(),
      type,
      message
    };
    this.logs.push(logEntry);
    if (this.logs.length > 100) this.logs.shift();
    this.broadcast('log', logEntry);
  }

  async initAgent() {
    // Создаём executor для работы через расширение
    const extensionExecutor = this.useExtension 
      ? (type: string, data?: any) => this.sendToExtension(type, data)
      : undefined;

    this.agent = new AIAgent(this.config, {
      onLog: (message, type) => this.log(message, type),
      onSecurityPrompt: async (warning) => {
        return new Promise((resolve) => {
          this.pendingSecurityPrompt = { resolve, warning };
          this.broadcast('securityPrompt', { warning });
        });
      },
      onUserInput: async (question) => {
        return new Promise((resolve) => {
          console.log('[Server] onUserInput called, broadcasting:', question);
          this.pendingUserInput = { resolve, question };
          this.broadcast('userInput', { question });
        });
      }
    }, extensionExecutor);

    if (this.useExtension) {
      // Режим расширения - агент будет использовать WebSocket для управления браузером
      this.log('Режим работы: через браузерное расширение', 'info');
      this.log('Установите расширение Bragent и откройте браузер', 'info');
    } else {
      await this.agent.initialize();
      this.log('Браузер готов к работе!', 'success');
    }
  }

  // Инициализация WebSocket для связи с расширением
  private initExtensionWebSocket(server: Server): void {
    this.extensionWs = new WebSocketServer({ server, path: '/extension' });
    
    this.extensionWs.on('connection', (ws) => {
      console.log('🔌 Расширение браузера подключено!');
      this.extensionSocket = ws;
      this.log('Расширение подключено! Готов к работе.', 'success');
      this.broadcast('extensionConnected', {});

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleExtensionMessage(message);
        } catch (e) {
          console.error('Ошибка парсинга сообщения от расширения:', e);
        }
      });

      ws.on('close', () => {
        console.log('🔌 Расширение отключено');
        this.extensionSocket = null;
        this.log('Расширение отключено', 'warning');
        this.broadcast('extensionDisconnected', {});
      });
    });
  }

  // Обработка ответа от расширения
  private handleExtensionMessage(message: { id: string; result: any }) {
    console.log('[Extension Response]', JSON.stringify(message).slice(0, 500));
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(message.result);
      this.pendingRequests.delete(message.id);
    } else {
      console.log('[Extension] No pending request for id:', message.id);
    }
  }

  // Отправка команды расширению через long-polling
  async sendToExtension(type: string, data: any = {}, timeoutMs: number = 30000): Promise<any> {
    if (!this.extensionConnected && !this.extensionSocket) {
      console.log('[Extension] Not connected!');
      throw new Error('Расширение не подключено. Откройте браузер с установленным расширением Bragent.');
    }

    const id = `cmd_${++this.commandId}`;
    const command = { id, type, ...data };
    
    console.log('[Extension Request]', type, JSON.stringify(data).slice(0, 200));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        console.log('[Extension] Timeout for command:', id);
        reject(new Error('Таймаут ожидания ответа от расширения'));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      // Если есть ожидающий poll - отправляем команду сразу
      if (this.extensionPollResolve) {
        this.extensionPollResolve(command);
        this.extensionPollResolve = null;
      } else {
        // Иначе сохраняем для следующего poll
        this.pendingCommand = command;
      }
    });
  }

  // Проверка подключения расширения
  isExtensionConnected(): boolean {
    return this.extensionConnected || this.extensionSocket !== null;
  }

  async executeTask(task: string): Promise<TaskResult> {
    if (this.useExtension && !this.extensionSocket) {
      throw new Error('Расширение не подключено. Откройте браузер с установленным расширением Bragent.');
    }
    if (!this.agent) throw new Error('Agent not initialized');
    if (this.isRunning) throw new Error('Task already running');

    this.isRunning = true;
    this.currentTask = task;
    this.broadcast('taskStart', { task });

    try {
      const result = await this.agent.executeTask(task);
      this.broadcast('taskComplete', result);
      return result;
    } finally {
      this.isRunning = false;
      this.currentTask = '';
    }
  }

  handleSecurityResponse(approved: boolean) {
    if (this.pendingSecurityPrompt) {
      this.pendingSecurityPrompt.resolve(approved);
      this.pendingSecurityPrompt = null;
    }
  }

  handleUserInputResponse(answer: string) {
    if (this.pendingUserInput) {
      this.pendingUserInput.resolve(answer);
      this.pendingUserInput = null;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      currentTask: this.currentTask,
      logs: this.logs.slice(-50),
      pendingSecurityPrompt: this.pendingSecurityPrompt?.warning || null,
      pendingUserInput: this.pendingUserInput?.question || null,
      extensionConnected: this.isExtensionConnected(),
      mode: this.useExtension ? 'extension' : 'playwright'
    };
  }

  start(port: number = 3000) {
    this.httpServer = createServer((req, res) => this.handleRequest(req, res));

    // Инициализируем WebSocket для расширения
    if (this.useExtension) {
      this.initExtensionWebSocket(this.httpServer);
    }

    this.httpServer.listen(port, () => {
      console.log(`\n🌐 Bragent Web UI: http://localhost:${port}\n`);
      if (this.useExtension) {
        console.log('📦 Режим расширения: откройте браузер с установленным расширением Bragent');
      }
    });

    return this.httpServer;
  }

  async close() {
    if (this.agent) {
      await this.agent.close();
    }
    if (this.httpServer) {
      this.httpServer.close();
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // API Routes
    if (url.pathname === '/api/status') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(this.getStatus()));
      return;
    }

    if (url.pathname === '/api/task' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { task } = JSON.parse(body);
          res.setHeader('Content-Type', 'application/json');
          
          // Запускаем задачу асинхронно
          this.executeTask(task).catch(e => this.log(e.message, 'error'));
          
          res.end(JSON.stringify({ success: true, message: 'Task started' }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/security-response' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const { approved } = JSON.parse(body);
        this.handleSecurityResponse(approved);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      });
      return;
    }

    if (url.pathname === '/api/user-input' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const { answer } = JSON.parse(body);
        this.handleUserInputResponse(answer);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      });
      return;
    }

    // Long-polling эндпоинт для расширения
    if (url.pathname === '/api/extension/poll' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          JSON.parse(body); // Валидация
          
          this.extensionConnected = true;
          if (!this.extensionSocket) {
            this.log('Расширение подключено!', 'success');
            this.broadcast('extensionConnected', {});
          }
          this.extensionSocket = { send: () => {} } as any; // Маркер подключения

          res.setHeader('Content-Type', 'application/json');
          
          // Если есть ожидающая команда - отправляем сразу
          if (this.pendingCommand) {
            const cmd = this.pendingCommand;
            this.pendingCommand = null;
            res.end(JSON.stringify(cmd));
            return;
          }
          
          // Long-poll: ждём команду до 30 секунд
          const timeoutPromise = new Promise<null>(resolve => 
            setTimeout(() => resolve(null), 25000)
          );
          
          const commandPromise = new Promise<any>(resolve => {
            this.extensionPollResolve = resolve;
          });
          
          const command = await Promise.race([commandPromise, timeoutPromise]);
          this.extensionPollResolve = null;
          
          res.end(JSON.stringify(command || {}));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      return;
    }

    // Результат выполнения команды от расширения
    if (url.pathname === '/api/extension/result' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { id, result } = JSON.parse(body);
          this.commandResults.set(id, result);
          console.log('[Extension Result]', id, JSON.stringify(result).slice(0, 200));
          
          // Разрешаем ожидающий промис
          const pending = this.pendingRequests.get(id);
          if (pending) {
            clearTimeout(pending.timeout);
            pending.resolve(result);
            this.pendingRequests.delete(id);
          }
          
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      return;
    }

    // SSE для real-time обновлений
    if (url.pathname === '/api/events') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const client: WebSocketClient = {
        send: (data: string) => {
          res.write(`data: ${data}\n\n`);
        }
      };

      this.clients.add(client);
      
      // Отправляем текущий статус
      client.send(JSON.stringify({ event: 'status', data: this.getStatus() }));

      req.on('close', () => {
        this.clients.delete(client);
      });
      return;
    }

    // Статические файлы
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end(this.getHTML());
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  private getHTML(): string {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bragent - AI Browser Agent</title>
  <style>
    :root {
      --bg-primary: #1a1a2e;
      --bg-secondary: #16213e;
      --bg-card: #0f0f23;
      --accent: #6c5ce7;
      --accent-light: #a29bfe;
      --success: #00b894;
      --warning: #fdcb6e;
      --error: #e17055;
      --info: #74b9ff;
      --text: #dfe6e9;
      --text-dim: #636e72;
      --shadow: rgba(0, 0, 0, 0.3);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
      min-height: 100vh;
      color: var(--text);
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    /* Header */
    .header {
      text-align: center;
      padding: 30px 0;
    }

    .header h1 {
      font-size: 3rem;
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-light) 50%, var(--info) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 10px;
    }

    .header p {
      color: var(--text-dim);
      font-size: 1.1rem;
    }

    /* Neomorphic Card */
    .card {
      background: var(--bg-card);
      border-radius: 20px;
      padding: 25px;
      margin-bottom: 20px;
      box-shadow: 
        8px 8px 16px var(--shadow),
        -4px -4px 12px rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .card-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 1.2rem;
      margin-bottom: 20px;
      color: var(--accent-light);
    }

    /* Task Input */
    .task-form {
      display: flex;
      gap: 15px;
    }

    .task-input {
      flex: 1;
      background: var(--bg-secondary);
      border: 2px solid rgba(108, 92, 231, 0.3);
      border-radius: 15px;
      padding: 15px 20px;
      font-size: 1rem;
      color: var(--text);
      transition: all 0.3s ease;
    }

    .task-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 20px rgba(108, 92, 231, 0.2);
    }

    .task-input::placeholder {
      color: var(--text-dim);
    }

    .btn {
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-light) 100%);
      border: none;
      border-radius: 15px;
      padding: 15px 30px;
      font-size: 1rem;
      font-weight: 600;
      color: white;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(108, 92, 231, 0.4);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .btn-danger {
      background: linear-gradient(135deg, var(--error) 0%, #ff7675 100%);
    }

    .btn-success {
      background: linear-gradient(135deg, var(--success) 0%, #55efc4 100%);
    }

    /* Status Badge */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 0.9rem;
      font-weight: 500;
    }

    .status-idle {
      background: rgba(99, 110, 114, 0.2);
      color: var(--text-dim);
    }

    .status-running {
      background: rgba(108, 92, 231, 0.2);
      color: var(--accent-light);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    /* Logs */
    .logs-container {
      height: 400px;
      overflow-y: auto;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.9rem;
      padding: 10px;
      background: var(--bg-secondary);
      border-radius: 12px;
    }

    .log-entry {
      padding: 8px 12px;
      border-radius: 8px;
      margin-bottom: 6px;
      display: flex;
      gap: 12px;
      align-items: flex-start;
      transition: background 0.2s;
    }

    .log-entry:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .log-time {
      color: var(--text-dim);
      font-size: 0.8rem;
      min-width: 70px;
    }

    .log-icon {
      font-size: 1rem;
      min-width: 24px;
    }

    .log-message {
      flex: 1;
      word-break: break-word;
    }

    .log-info .log-message { color: var(--info); }
    .log-action .log-message { color: var(--accent-light); }
    .log-thought .log-message { color: var(--text-dim); font-style: italic; }
    .log-error .log-message { color: var(--error); }
    .log-success .log-message { color: var(--success); }
    .log-warning .log-message { color: var(--warning); }

    /* Modal */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      backdrop-filter: blur(5px);
    }

    .modal {
      background: var(--bg-card);
      border-radius: 20px;
      padding: 30px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .modal-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 1.3rem;
      margin-bottom: 20px;
    }

    .modal-content {
      margin-bottom: 25px;
      line-height: 1.6;
    }

    .modal-actions {
      display: flex;
      gap: 15px;
      justify-content: flex-end;
    }

    .modal-input {
      width: 100%;
      background: var(--bg-secondary);
      border: 2px solid rgba(108, 92, 231, 0.3);
      border-radius: 12px;
      padding: 12px 16px;
      font-size: 1rem;
      color: var(--text);
      margin-bottom: 20px;
    }

    .modal-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    /* Examples */
    .examples {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 15px;
    }

    .example-btn {
      background: rgba(108, 92, 231, 0.1);
      border: 1px solid rgba(108, 92, 231, 0.3);
      border-radius: 20px;
      padding: 8px 16px;
      font-size: 0.85rem;
      color: var(--accent-light);
      cursor: pointer;
      transition: all 0.2s;
    }

    .example-btn:hover {
      background: rgba(108, 92, 231, 0.2);
      border-color: var(--accent);
    }

    /* Grid */
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    @media (max-width: 768px) {
      .grid { grid-template-columns: 1fr; }
      .task-form { flex-direction: column; }
      .header h1 { font-size: 2rem; }
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
    }

    ::-webkit-scrollbar-track {
      background: var(--bg-secondary);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb {
      background: var(--accent);
      border-radius: 4px;
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>🤖 BRAGENT</h1>
      <p>Автономный AI-агент для управления браузером</p>
    </header>

    <!-- Task Input -->
    <div class="card">
      <div class="card-title">
        <span>📝</span>
        <span>Новая задача</span>
        <span id="statusBadge" class="status-badge status-idle">⚪ Готов</span>
      </div>
      <form class="task-form" id="taskForm">
        <input 
          type="text" 
          class="task-input" 
          id="taskInput" 
          placeholder="Например: Открой google.com и найди погоду в Москве..."
          autocomplete="off"
        >
        <button type="submit" class="btn" id="submitBtn">
          <span>▶️</span>
          <span>Запустить</span>
        </button>
      </form>
      <div class="examples">
        <button class="example-btn" data-task="Открой youtube.com и найди видео про космос">🎬 YouTube поиск</button>
        <button class="example-btn" data-task="Открой google.com и найди погоду в Москве">🌤️ Погода</button>
        <button class="example-btn" data-task="Открой wikipedia.org и найди статью про искусственный интеллект">📚 Wikipedia</button>
      </div>
    </div>

    <!-- Logs -->
    <div class="card">
      <div class="card-title">
        <span>📋</span>
        <span>Лог действий</span>
      </div>
      <div class="logs-container" id="logsContainer">
        <div class="log-entry log-info">
          <span class="log-time">--:--:--</span>
          <span class="log-icon">💡</span>
          <span class="log-message">Ожидание задачи...</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Security Modal -->
  <div class="modal-overlay hidden" id="securityModal">
    <div class="modal">
      <div class="modal-title" style="color: var(--warning)">
        <span>⚠️</span>
        <span>Подтверждение действия</span>
      </div>
      <div class="modal-content" id="securityContent"></div>
      <div class="modal-actions">
        <button class="btn btn-danger" id="securityDeny">❌ Отменить</button>
        <button class="btn btn-success" id="securityApprove">✅ Подтвердить</button>
      </div>
    </div>
  </div>

  <!-- User Input Modal -->
  <div class="modal-overlay hidden" id="inputModal">
    <div class="modal">
      <div class="modal-title" style="color: var(--info)">
        <span>❓</span>
        <span>Вопрос от агента</span>
      </div>
      <div class="modal-content" id="inputQuestion"></div>
      <input type="text" class="modal-input" id="userAnswer" placeholder="Ваш ответ...">
      <div class="modal-actions">
        <button class="btn" id="submitAnswer">📤 Отправить</button>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = '';
    
    // DOM Elements
    const taskForm = document.getElementById('taskForm');
    const taskInput = document.getElementById('taskInput');
    const submitBtn = document.getElementById('submitBtn');
    const statusBadge = document.getElementById('statusBadge');
    const logsContainer = document.getElementById('logsContainer');
    const securityModal = document.getElementById('securityModal');
    const securityContent = document.getElementById('securityContent');
    const inputModal = document.getElementById('inputModal');
    const inputQuestion = document.getElementById('inputQuestion');
    const userAnswer = document.getElementById('userAnswer');

    const logIcons = {
      info: '💡',
      action: '⚡',
      thought: '💭',
      error: '❌',
      success: '✅',
      warning: '⚠️'
    };

    // Event Source for real-time updates
    const eventSource = new EventSource('/api/events');
    
    eventSource.onmessage = (event) => {
      const { event: eventType, data } = JSON.parse(event.data);
      
      switch (eventType) {
        case 'status':
          updateStatus(data);
          break;
        case 'log':
          addLog(data);
          break;
        case 'taskStart':
          setRunning(true, data.task);
          break;
        case 'taskComplete':
          setRunning(false);
          showResult(data);
          break;
        case 'securityPrompt':
          showSecurityModal(data.warning);
          break;
        case 'userInput':
          console.log('[WS] Received userInput:', data.question);
          showInputModal(data.question);
          break;
      }
    };

    function updateStatus(status) {
      if (status.isRunning) {
        setRunning(true, status.currentTask);
      }
      if (status.logs) {
        logsContainer.innerHTML = '';
        status.logs.forEach(addLog);
      }
      if (status.pendingSecurityPrompt) {
        showSecurityModal(status.pendingSecurityPrompt);
      }
      if (status.pendingUserInput) {
        showInputModal(status.pendingUserInput);
      }
    }

    function addLog(log) {
      const entry = document.createElement('div');
      entry.className = \`log-entry log-\${log.type}\`;
      entry.innerHTML = \`
        <span class="log-time">\${log.time}</span>
        <span class="log-icon">\${logIcons[log.type] || '📌'}</span>
        <span class="log-message">\${escapeHtml(log.message)}</span>
      \`;
      logsContainer.appendChild(entry);
      logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    function setRunning(running, task = '') {
      if (running) {
        statusBadge.className = 'status-badge status-running';
        statusBadge.textContent = '🔵 Выполняется...';
        submitBtn.disabled = true;
        taskInput.disabled = true;
      } else {
        statusBadge.className = 'status-badge status-idle';
        statusBadge.textContent = '⚪ Готов';
        submitBtn.disabled = false;
        taskInput.disabled = false;
      }
    }

    function showResult(result) {
      const icon = result.success ? '✅' : '❌';
      addLog({
        time: new Date().toLocaleTimeString(),
        type: result.success ? 'success' : 'error',
        message: \`\${icon} Задача завершена: \${result.summary}\`
      });
    }

    function showSecurityModal(warning) {
      securityContent.textContent = warning;
      securityModal.classList.remove('hidden');
    }

    function showInputModal(question) {
      console.log('[UI] showInputModal called:', question);
      inputQuestion.textContent = question;
      userAnswer.value = '';
      inputModal.classList.remove('hidden');
      inputModal.style.zIndex = '9999';
      userAnswer.focus();
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Event Handlers
    taskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const task = taskInput.value.trim();
      if (!task) return;
      
      try {
        await fetch('/api/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task })
        });
        taskInput.value = '';
      } catch (err) {
        alert('Ошибка: ' + err.message);
      }
    });

    document.querySelectorAll('.example-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        taskInput.value = btn.dataset.task;
        taskInput.focus();
      });
    });

    document.getElementById('securityApprove').addEventListener('click', async () => {
      await fetch('/api/security-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true })
      });
      securityModal.classList.add('hidden');
    });

    document.getElementById('securityDeny').addEventListener('click', async () => {
      await fetch('/api/security-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: false })
      });
      securityModal.classList.add('hidden');
    });

    document.getElementById('submitAnswer').addEventListener('click', async () => {
      const answer = userAnswer.value.trim();
      if (!answer) return;
      
      await fetch('/api/user-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer })
      });
      inputModal.classList.add('hidden');
    });

    userAnswer.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('submitAnswer').click();
      }
    });
  </script>
</body>
</html>`;
  }
}
