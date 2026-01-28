import { chromium, firefox, Browser, BrowserContext, Page } from 'playwright';
import { BrowserAction, PageContext, PageElement, FormInfo, LinkInfo, FormField } from '../types/index.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';

export type BrowserType = 'chromium' | 'chrome' | 'yandex' | 'firefox' | 'edge';

export class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private userDataDir: string;
  private headless: boolean;
  private slowMo: number;
  private browserType: BrowserType;
  private customBrowserPath?: string;
  private browserProcess: ChildProcess | null = null;
  private debuggingPort: number = 9222;

  constructor(
    userDataDir: string = './browser-data', 
    headless: boolean = false, 
    slowMo: number = 50,
    browserType: BrowserType = 'chromium',
    customBrowserPath?: string
  ) {
    this.userDataDir = path.resolve(userDataDir);
    this.headless = headless;
    this.slowMo = slowMo;
    this.browserType = browserType;
    this.customBrowserPath = customBrowserPath;
  }

  private getYandexBrowserPath(): string | undefined {
    const possiblePaths = [
      // Windows
      path.join(os.homedir(), 'AppData', 'Local', 'Yandex', 'YandexBrowser', 'Application', 'browser.exe'),
      'C:\\Program Files\\Yandex\\YandexBrowser\\Application\\browser.exe',
      'C:\\Program Files (x86)\\Yandex\\YandexBrowser\\Application\\browser.exe',
      // Linux
      '/usr/bin/yandex-browser',
      '/usr/bin/yandex-browser-stable',
      // macOS
      '/Applications/Yandex.app/Contents/MacOS/Yandex',
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  }

  private async launchBrowserWithDebugging(executablePath: string): Promise<void> {
    const args = [
      `--remote-debugging-port=${this.debuggingPort}`,
      `--user-data-dir=${this.userDataDir}`,
      '--profile-directory=Default',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
      '--no-first-run',
      '--disable-default-apps',
      '--restore-last-session',
      // Флаги для работы расширений
      '--enable-features=ExtensionsToolbarMenu',
      '--allow-running-insecure-content',
    ];

    console.log(`🚀 Запуск браузера: ${executablePath}`);
    console.log(`   Порт отладки: ${this.debuggingPort}`);

    this.browserProcess = spawn(executablePath, args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Логируем вывод браузера для отладки (фильтруем спам)
    const ignoredErrors = [
      'DevTools listening',
      'cpu_probe_win',
      'PdhAddEnglishCounter',
      'DEPRECATED_ENDPOINT',
      'registration_request',
      'passman_store',
      'No encryptor',
      'isolated_origin_util',
      'cloud_management_controller',
      'anti_tracking_service',
      'registry_features',
      'parsed_gpu_control_list',
      'ParseFeatures failed',
      'disable_direct_composition',
      'shared_space_service',
    ];

    this.browserProcess.stdout?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !ignoredErrors.some(e => msg.includes(e))) {
        console.log(`[Browser] ${msg}`);
      }
    });

    this.browserProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !ignoredErrors.some(e => msg.includes(e))) {
        console.log(`[Browser] ${msg}`);
      }
    });

    this.browserProcess.on('error', (err) => {
      console.error('❌ Ошибка запуска браузера:', err);
    });

    this.browserProcess.on('exit', (code) => {
      console.log(`[Browser] Процесс завершился с кодом: ${code}`);
    });

    // Ждём пока браузер запустится
    await this.waitForBrowserReady();
  }

  // Проверка запущен ли браузер с remote debugging
  private async checkBrowserRunning(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.debuggingPort}/json/version`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitForBrowserReady(maxAttempts: number = 60): Promise<void> {
    const url = `http://127.0.0.1:${this.debuggingPort}/json/version`;
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          console.log('✅ Браузер готов к подключению');
          return;
        }
      } catch {
        // Браузер ещё не готов
        if (i % 10 === 0 && i > 0) {
          console.log(`⏳ Ожидание браузера... (${i}/${maxAttempts})`);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Браузер не найден. Запустите браузер с флагом --remote-debugging-port=9222');
  }

  async initialize(): Promise<void> {
    // Для Яндекс, Chrome, Edge - только подключаемся к уже запущенному браузеру
    if (this.browserType === 'yandex' || this.browserType === 'chrome' || this.browserType === 'edge') {
      // Проверяем, запущен ли браузер с remote debugging
      const isRunning = await this.checkBrowserRunning();
      
      if (!isRunning) {
        // Выводим инструкцию
        console.log('\n' + '═'.repeat(70));
        console.log('⚠️  БРАУЗЕР НЕ НАЙДЕН НА ПОРТУ 9222');
        console.log('═'.repeat(70));
        console.log('\n📋 Запустите браузер вручную с флагом отладки:\n');
        
        if (this.browserType === 'yandex') {
          console.log('   Яндекс Браузер:');
          console.log('   "C:\\Users\\Noon\\AppData\\Local\\Yandex\\YandexBrowser\\Application\\browser.exe" --remote-debugging-port=9222');
        } else if (this.browserType === 'chrome') {
          console.log('   Chrome:');
          console.log('   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222');
        } else {
          console.log('   Edge:');
          console.log('   "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --remote-debugging-port=9222');
        }
        
        console.log('\n💡 Или создайте ярлык с этим флагом для удобства');
        console.log('═'.repeat(70) + '\n');
        
        // Ждём пока пользователь запустит браузер
        console.log('⏳ Ожидаю запуска браузера...');
        await this.waitForBrowserReady(120); // 2 минуты
      }
      
      // Подключаемся через CDP
      this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debuggingPort}`, {
        slowMo: this.slowMo
      });
      
      // Получаем контекст и страницу
      const contexts = this.browser.contexts();
      this.context = contexts[0] || await this.browser.newContext();
      
      const pages = this.context.pages();
      this.page = pages[0] || await this.context.newPage();
      
      console.log(`🌐 Браузер: ${this.browserType} (CDP connect)`);
    } else if (this.browserType === 'firefox') {
      // Firefox
      this.browser = await firefox.launch({
        headless: this.headless,
        slowMo: this.slowMo,
      });
      this.context = await this.browser.newContext({
        viewport: null,
      });
      this.page = await this.context.newPage();
      console.log('🌐 Браузер: Firefox');
    } else {
      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: this.headless,
        slowMo: this.slowMo,
        viewport: null,
        args: ['--start-maximized'],
        timeout: 60000,
      });
      const pages = this.context.pages();
      this.page = pages[0] || await this.context.newPage();
      console.log('🌐 Браузер: Chromium');
    }

    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
    });


    const currentUrl = this.page.url();
    if (!currentUrl || currentUrl === 'about:blank' || currentUrl.startsWith('chrome://') || currentUrl.startsWith('yandex://')) {
      await this.page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
    }
  }

  private findChromePath(): string | undefined {
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  }

  private findEdgePath(): string | undefined {
    const paths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  }

  async close(): Promise<void> {
    // Закрываем Playwright соединение
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }
    if (this.context) {
      await this.context.close().catch(() => {});
    }
    
    // Завершаем процесс браузера если запускали сами
    if (this.browserProcess) {
      this.browserProcess.kill();
      this.browserProcess = null;
    }
  }

  getPage(): Page {
    if (!this.page) throw new Error('Browser not initialized');
    return this.page;
  }

  // Проверка активности соединения с браузером
  async isConnected(): Promise<boolean> {
    try {
      if (!this.page) return false;
      // Пробуем выполнить простую операцию
      await this.page.evaluate(() => true);
      return true;
    } catch {
      return false;
    }
  }

  // Переподключение к браузеру
  async reconnect(): Promise<void> {
    console.log('🔄 Переподключение к браузеру...');
    
    try {
      // Пробуем подключиться к существующему процессу
      const url = `http://127.0.0.1:${this.debuggingPort}/json/version`;
      const response = await fetch(url);
      
      if (response.ok) {
        // Браузер ещё работает, переподключаемся
        this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debuggingPort}`, {
          slowMo: this.slowMo
        });
        
        const contexts = this.browser.contexts();
        this.context = contexts[0] || await this.browser.newContext();
        
        const pages = this.context.pages();
        this.page = pages[0] || await this.context.newPage();
        
        console.log('✅ Переподключение успешно!');
      } else {
        throw new Error('Браузер не отвечает');
      }
    } catch {
      // Браузер закрыт, перезапускаем
      console.log('🔄 Браузер закрыт, перезапуск...');
      await this.initialize();
    }
  }

  // Проверка и восстановление соединения перед операцией
  private async ensureConnection(): Promise<void> {
    if (!(await this.isConnected())) {
      await this.reconnect();
    }
  }

  async executeAction(action: BrowserAction): Promise<string> {
    // Проверяем соединение перед выполнением действия
    await this.ensureConnection();
    
    if (!this.page) throw new Error('Browser not initialized');

    try {
      switch (action.type) {
        case 'navigate':
          if (!action.url) throw new Error('URL required for navigate');
          await this.page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          // Дополнительное ожидание для стабилизации страницы
          await this.page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
          await this.page.waitForTimeout(500);
          return `Navigated to ${action.url}`;

        case 'click':
          if (!action.selector) throw new Error('Selector required for click');
          await this.page.waitForSelector(action.selector, { timeout: 10000 });
          await this.page.click(action.selector);
          await this.page.waitForTimeout(500);
          return `Clicked on element: ${action.selector}`;

        case 'type_text':
          if (!action.selector || action.text === undefined) 
            throw new Error('Selector and text required for type_text');
          await this.page.waitForSelector(action.selector, { timeout: 10000 });
          await this.page.fill(action.selector, '');
          await this.page.type(action.selector, action.text, { delay: 30 });
          return `Typed "${action.value}" into ${action.selector}`;

        case 'hover':
          if (!action.selector) throw new Error('Selector required for hover');
          await this.page.waitForSelector(action.selector, { timeout: 10000 });
          await this.page.hover(action.selector);
          return `Hovered over element: ${action.selector}`;

        case 'select':
          if (!action.selector || !action.value) 
            throw new Error('Selector and value required for select');
          await this.page.selectOption(action.selector, action.value);
          return `Selected "${action.value}" in ${action.selector}`;

        case 'scroll':
          const direction = action.direction || 'down';
          const amount = action.amount || 500;
          await this.page.evaluate(({ dir, amt }) => {
            window.scrollBy(0, dir === 'down' ? amt : -amt);
          }, { dir: direction, amt: amount });
          return `Scrolled ${direction} by ${amount}px`;

        case 'wait':
          const waitTime = action.amount || 1000;
          await this.page.waitForTimeout(waitTime);
          return `Waited for ${waitTime}ms`;

        case 'press_key':
          if (!action.key) throw new Error('Key required for press_key');
          await this.page.keyboard.press(action.key);
          return `Pressed key: ${action.key}`;

        case 'go_back':
          await this.page.goBack();
          await this.page.waitForTimeout(500);
          return 'Navigated back';

        case 'go_forward':
          await this.page.goForward();
          await this.page.waitForTimeout(500);
          return 'Navigated forward';

        case 'refresh':
          await this.page.reload();
          await this.page.waitForTimeout(1000);
          return 'Page refreshed';

        case 'screenshot':
          const screenshotPath = `./screenshots/screenshot-${Date.now()}.png`;
          if (!fs.existsSync('./screenshots')) {
            fs.mkdirSync('./screenshots', { recursive: true });
          }
          await this.page.screenshot({ path: screenshotPath, fullPage: false });
          return `Screenshot saved to ${screenshotPath}`;

        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Action failed: ${errorMsg}`);
    }
  }

  async extractPageContext(): Promise<PageContext> {
    // Проверяем соединение перед извлечением контекста
    await this.ensureConnection();
    
    if (!this.page) throw new Error('Browser not initialized');

    try {
      // Ждём стабилизации страницы
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      
      const url = this.page.url();
      let title = '';
      try {
        title = await this.page.title();
      } catch {
        title = 'Загрузка...';
      }

      // Извлекаем интерактивные элементы с умным сжатием
      const elements = await this.extractInteractiveElements();
      
      // Извлекаем основной текстовый контент (сжатый)
      const textContent = await this.extractTextContent();
      
      // Извлекаем формы
      const forms = await this.extractForms();
      
      // Извлекаем ссылки
      const links = await this.extractLinks();

      return {
        url,
        title,
        elements,
        textContent,
        forms,
        links,
        timestamp: Date.now()
      };
    } catch (error) {
      // Если страница в процессе навигации, возвращаем минимальный контекст
      console.error('Error extracting context:', error);
      return {
        url: this.page.url(),
        title: 'Страница загружается...',
        elements: [],
        textContent: '',
        forms: [],
        links: [],
        timestamp: Date.now()
      };
    }
  }

  private async extractInteractiveElements(): Promise<PageElement[]> {
    if (!this.page) return [];

    // Используем строку чтобы избежать проблем с tsx/esbuild __name
    const script = `
      (() => {
        if (!document.body) return [];
        try {
        const interactiveSelectors = [
          'button', 'a[href]', 'input', 'textarea', 'select',
          '[role="button"]', '[role="link"]', '[role="menuitem"]',
          '[role="tab"]', '[onclick]', '[data-action]', '.btn', '.button'
        ];

        const elements = [];
        let index = 0;
        const seen = new Set();

        function getSelector(element) {
          if (element.id) return '#' + element.id;
          if (element.getAttribute('data-testid')) 
            return '[data-testid="' + element.getAttribute('data-testid') + '"]';
          if (element.getAttribute('name'))
            return element.tagName.toLowerCase() + '[name="' + element.getAttribute('name') + '"]';
          
          const path = [];
          let current = element;
          
          while (current && current !== document.body && path.length < 4) {
            let sel = current.tagName.toLowerCase();
            
            if (current.className && typeof current.className === 'string') {
              const classes = current.className.trim().split(/\\s+/)
                .filter(function(c) { return c && c.indexOf(':') === -1 && c.length < 30; })
                .slice(0, 2);
              if (classes.length > 0) {
                sel += '.' + classes.join('.');
              }
            }
            
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(
                function(c) { return c.tagName === current.tagName; }
              );
              if (siblings.length > 1) {
                const idx = siblings.indexOf(current) + 1;
                sel += ':nth-child(' + idx + ')';
              }
            }
            
            path.unshift(sel);
            current = current.parentElement;
          }
          
          return path.join(' > ');
        }

        interactiveSelectors.forEach(function(selector) {
          document.querySelectorAll(selector).forEach(function(el) {
            const rect = el.getBoundingClientRect();
            
            const isVisible = rect.width > 0 && rect.height > 0 && 
              window.getComputedStyle(el).display !== 'none' &&
              window.getComputedStyle(el).visibility !== 'hidden';

            if (!isVisible) return;

            const elSelector = getSelector(el);
            if (seen.has(elSelector)) return;
            seen.add(elSelector);

            const attrs = {};
            ['type', 'name', 'placeholder', 'value', 'href', 'aria-label', 'title', 'role']
              .forEach(function(attr) {
                const val = el.getAttribute(attr);
                if (val) attrs[attr] = val.slice(0, 100);
              });

            let text = el.innerText || el.textContent || '';
            text = text.trim().slice(0, 100);
            if (!text && el.getAttribute('aria-label')) text = el.getAttribute('aria-label');
            if (!text && el.getAttribute('title')) text = el.getAttribute('title');
            if (!text && el.getAttribute('placeholder')) text = '[' + el.getAttribute('placeholder') + ']';

            elements.push({
              index: index++,
              tag: el.tagName.toLowerCase(),
              text: text,
              selector: elSelector,
              attributes: attrs,
              isInteractive: true,
              isVisible: true,
              boundingBox: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            });
          });
        });

        return elements.slice(0, 100);
        } catch (e) { return []; }
      })()
    `;

    try {
      return await this.page.evaluate(script) as PageElement[];
    } catch (error) {
      console.error('Error extracting elements:', error);
      return [];
    }
  }

  private async extractTextContent(): Promise<string> {
    if (!this.page) return '';

    const script = `
      (() => {
        if (!document.body) return '';
        try {
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('script, style, noscript, svg, path').forEach(function(el) { el.remove(); });
          let content = clone.innerText || '';
          content = content.replace(/\\s+/g, ' ').trim();
          return content.slice(0, 5000);
        } catch (e) {
          return '';
        }
      })()
    `;

    try {
      return await this.page.evaluate(script) as string;
    } catch (error) {
      console.error('Error extracting text:', error);
      return '';
    }
  }

  private async extractForms(): Promise<FormInfo[]> {
    if (!this.page) return [];

    const script = `
      (() => {
        if (!document.body) return [];
        try {
        const forms = [];
        
        document.querySelectorAll('form').forEach(function(form, formIndex) {
          const fields = [];
          
          form.querySelectorAll('input, textarea, select').forEach(function(field) {
            const name = field.name || field.id || 'field-' + fields.length;
            
            let selector = '';
            if (field.id) {
              selector = '#' + field.id;
            } else if (field.name) {
              selector = field.tagName.toLowerCase() + '[name="' + field.name + '"]';
            }

            fields.push({
              name: name,
              type: field.type || 'text',
              placeholder: field.placeholder || undefined,
              value: field.value,
              required: field.required,
              selector: selector
            });
          });

          forms.push({
            index: formIndex,
            action: form.action,
            method: form.method,
            fields: fields
          });
        });

        return forms.slice(0, 10);
        } catch(e) { return []; }
      })()
    `;

    try {
      return await this.page.evaluate(script) as FormInfo[];
    } catch (error) {
      console.error('Error extracting forms:', error);
      return [];
    }
  }

  private async extractLinks(): Promise<LinkInfo[]> {
    if (!this.page) return [];

    const script = `
      (() => {
        if (!document.body) return [];
        try {
        const links = [];
        
        document.querySelectorAll('a[href]').forEach(function(link, index) {
          const rect = link.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          
          let text = link.innerText || link.textContent || '';
          text = text.trim().slice(0, 100);
          if (!text) text = link.title || link.href;

          let selector = '';
          if (link.id) {
            selector = '#' + link.id;
          } else {
            const href = link.getAttribute('href');
            selector = 'a[href="' + (href || '').replace(/"/g, '\\\\"') + '"]';
          }

          links.push({
            index: index,
            text: text,
            href: link.href,
            selector: selector
          });
        });

        return links.slice(0, 50);
        } catch(e) { return []; }
      })()
    `;

    try {
      return await this.page.evaluate(script) as LinkInfo[];
    } catch (error) {
      console.error('Error extracting links:', error);
      return [];
    }
  }

  async getCurrentUrl(): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');
    return this.page.url();
  }

  async getPageTitle(): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');
    return await this.page.title();
  }

  async waitForNavigation(timeout: number = 30000): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.waitForLoadState('domcontentloaded', { timeout });
  }
}
