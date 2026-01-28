// Content script - выполняется на каждой странице
// Извлекает информацию и выполняет действия по команде от background.js

(function() {
  // Перехватываем window.open чтобы не открывались новые вкладки при кликах
  const originalWindowOpen = window.open;
  let blockNewTabs = false;
  
  window.open = function(url, target, features) {
    if (blockNewTabs) {
      console.log('[Bragent] Blocked window.open:', url);
      // Вместо открытия новой вкладки - навигируем в текущей
      if (url && url !== 'about:blank') {
        window.location.href = url;
      }
      return null;
    }
    return originalWindowOpen.call(window, url, target, features);
  };

  // Слушаем сообщения от background.js
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPageContext') {
      sendResponse(getPageContext());
    } else if (request.action === 'click') {
      // Блокируем новые вкладки на время клика
      blockNewTabs = true;
      clickElement(request.selector).then(result => {
        // Снимаем блокировку через 500мс
        setTimeout(() => { blockNewTabs = false; }, 500);
        sendResponse(result);
      });
      return true; // важно для async
    } else if (request.action === 'type') {
      sendResponse(typeText(request.selector, request.value));
    } else if (request.action === 'scroll') {
      sendResponse(scrollPage(request.direction, request.amount));
    } else if (request.action === 'extractText') {
      sendResponse(extractText(request.selector, request.maxLength));
    } else if (request.action === 'pressKey') {
      sendResponse(pressKey(request.key));
    }
    return true; // async response
  });

  // Нажатие клавиши
  function pressKey(key) {
    try {
      const keyMap = {
        'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
        'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
        'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
        'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }
      };
      
      const keyInfo = keyMap[key] || { key, code: key, keyCode: 0 };
      const activeEl = document.activeElement || document.body;
      
      activeEl.dispatchEvent(new KeyboardEvent('keydown', { ...keyInfo, bubbles: true }));
      activeEl.dispatchEvent(new KeyboardEvent('keyup', { ...keyInfo, bubbles: true }));
      
      return { success: true, message: `Нажата клавиша: ${key}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Проверить есть ли открытое модальное окно
  function detectModal() {
    // Яндекс.Еда и другие сайты
    const modalSelectors = [
      '[data-testid*="modal"]',
      '[data-testid*="dialog"]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[class*="modal"][class*="open"]',
      '[class*="Modal"][class*="open"]',
      '[class*="overlay"][style*="visible"]',
      '.ReactModal__Overlay--after-open',
      '[class*="Popup"][class*="visible"]'
    ];
    
    for (const sel of modalSelectors) {
      const modal = document.querySelector(sel);
      if (modal) {
        const rect = modal.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100) {
          return modal;
        }
      }
    }
    
    // Fallback: ищем элемент который затемняет фон
    const overlay = document.querySelector('[class*="overlay"], [class*="Overlay"], [class*="backdrop"], [class*="Backdrop"]');
    if (overlay && getComputedStyle(overlay).position === 'fixed') {
      return overlay;
    }
    
    return null;
  }

  // Получить контекст страницы
  function getPageContext() {
    try {
      // Проверяем есть ли модальное окно
      const modal = detectModal();
      const hasModal = !!modal;
      
      // Интерактивные элементы (расширенный список для Gmail, Яндекс.Еда и других SPA)
      const interactiveSelectors = [
        'button', 'a', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="checkbox"]',
        '[role="option"]', '[role="tab"]', '[role="listitem"]',
        '[onclick]', '[tabindex]:not([tabindex="-1"])',
        '[aria-label]', '[data-tooltip]',
        // Кнопки добавления в корзину (Яндекс.Еда и т.д.)
        '[data-testid*="increment"]', '[data-testid*="add"]', '[data-testid*="cart"]',
        '[data-testid*="plus"]', '[data-testid*="minus"]', '[data-testid*="checkout"]',
        '[data-testid*="basket"]', '[data-testid*="order"]',
        // Gmail specific
        '.T-I', '.aT5-aOt-I', '.bA4',
        'span[jsaction]', 'div[jsaction]',
        '[jscontroller]', '[data-action-data]'
      ];
      
      // Если есть модалка - ищем элементы ТОЛЬКО в ней
      const searchRoot = hasModal ? modal : document;
      const allElements = searchRoot.querySelectorAll(interactiveSelectors.join(','));
      let index = 0;
      const MAX_ELEMENTS = 200; // Увеличили лимит
      
      // Собираем видимые элементы
      const viewportHeight = window.innerHeight;
      const visibleElements = [];
      
      // ПРИОРИТЕТ 1: Фиксированные элементы (header, корзина, навигация) - ВСЕГДА собираем
      document.querySelectorAll('header, nav, [class*="header"], [class*="Header"], [class*="navbar"], [class*="Navbar"]').forEach(container => {
        container.querySelectorAll('button, a, [role="button"], [aria-label]').forEach(el => {
          if (index >= MAX_ELEMENTS) return;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          
          const ariaLabel = el.getAttribute('aria-label') || '';
          const text = ariaLabel || el.textContent?.trim().slice(0, 50) || '';
          if (!text) return;
          
          // Генерируем уникальный селектор
          let selector = '';
          if (el.id) selector = `#${el.id}`;
          else if (ariaLabel) selector = `[aria-label="${ariaLabel}"]`;
          else if (el.getAttribute('data-testid')) selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
          else selector = generateSelector(el);
          
          if (visibleElements.some(e => e.selector === selector)) return;
          
          visibleElements.push({
            index: index++,
            tag: el.tagName.toLowerCase(),
            type: 'header-nav',
            text: text,
            selector: selector,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          });
        });
      });
      
      // ПРИОРИТЕТ 2: Кнопки корзины/оформления заказа
      document.querySelectorAll('[data-testid*="increment"], [data-testid*="cart"], [data-testid*="checkout"], [data-testid*="basket"], [aria-label*="корзин"], [aria-label*="Корзин"], [aria-label*="Добавить"], [aria-label*="добавить"], [aria-label*="Оформить"]').forEach(el => {
        if (index >= MAX_ELEMENTS) return;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const ariaLabel = el.getAttribute('aria-label') || '';
          const testId = el.getAttribute('data-testid') || '';
          const existingSelector = testId ? `[data-testid="${testId}"]` : (ariaLabel ? `[aria-label="${ariaLabel}"]` : generateSelector(el));
          if (visibleElements.some(e => e.selector === existingSelector)) return;
          visibleElements.push({
            index: index++,
            tag: el.tagName.toLowerCase(),
            type: 'cart-button',
            text: ariaLabel || testId || '+',
            selector: existingSelector,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          });
        }
      });
      
      // ПРИОРИТЕТ 3: Плавающие кнопки (position: fixed) - корзина, чат и т.д.
      document.querySelectorAll('button, a, [role="button"]').forEach(el => {
        if (index >= MAX_ELEMENTS) return;
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed') return;
        
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const text = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 50) || '';
        const selector = generateSelector(el);
        if (visibleElements.some(e => e.selector === selector)) return;
        
        visibleElements.push({
          index: index++,
          tag: el.tagName.toLowerCase(),
          type: 'floating-button',
          text: text,
          selector: selector,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        });
      });
      
      // Также ищем элементы по тексту "Удалить" для Gmail
      const deleteButtons = [];
      document.querySelectorAll('span, div, button').forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text.includes('Удалить') || text.includes('Delete')) {
          deleteButtons.push(el);
        }
      });
      
      // Добавляем найденные кнопки удаления
      deleteButtons.forEach(el => {
        if (index >= MAX_ELEMENTS) return;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const existingSelector = generateSelector(el);
          if (visibleElements.some(e => e.selector === existingSelector)) return;
          const text = el.textContent?.trim().slice(0, 100) || '';
          visibleElements.push({
            index: index++,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('role') || 'delete-button',
            text: text,
            selector: existingSelector,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          });
        }
      });
      
      allElements.forEach(el => {
        if (index >= MAX_ELEMENTS) return;
        
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        // Пропускаем если уже добавлен (дедупликация)
        const existingSelector = generateSelector(el);
        if (visibleElements.some(e => e.selector === existingSelector)) return;
        
        // Проверяем видимость в расширенной области viewport
        const inViewport = rect.top > -500 && rect.top < viewportHeight + 500;
        if (!inViewport) return;
        
        // Получаем текст из разных источников
        const text = (
          el.getAttribute('aria-label') || 
          el.getAttribute('data-tooltip') ||
          el.textContent || 
          el.value || 
          el.placeholder || 
          el.title || 
          el.alt || 
          ''
        ).trim().slice(0, 100);
        
        // Принимаем элементы даже без текста если есть aria-label или это интерактивный элемент
        const hasAriaLabel = el.hasAttribute('aria-label');
        const isInteractive = ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(el.tagName);
        if (!text && !hasAriaLabel && !isInteractive) return;
        
        visibleElements.push({
          index: index++,
          tag: el.tagName.toLowerCase(),
          type: el.type || el.getAttribute('role') || null,
          text: text,
          selector: existingSelector,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        });
      });
      
      // Сортируем по Y позиции (сверху вниз)
      visibleElements.sort((a, b) => a.rect.y - b.rect.y);
      
      // Формы
      const forms = [];
      document.querySelectorAll('form').forEach((form, i) => {
        if (i >= 10) return;
        const inputs = [];
        form.querySelectorAll('input, select, textarea').forEach(input => {
          inputs.push({
            name: input.name || input.id,
            type: input.type || 'text',
            placeholder: input.placeholder || '',
            value: input.value || ''
          });
        });
        forms.push({
          action: form.action,
          method: form.method,
          inputs: inputs.slice(0, 20)
        });
      });
      
      // Извлекаем текст более аккуратно - без script и style
      let pageText = '';
      try {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
        pageText = clone.innerText?.slice(0, 5000) || '';
      } catch (e) {
        pageText = '';
      }
      
      return {
        success: true,
        url: window.location.href,
        title: document.title,
        elements: visibleElements,
        forms: forms,
        hasModal: hasModal,
        modalHint: hasModal ? 'Открыто модальное окно. Используй элементы внутри него или press_key("Escape") чтобы закрыть.' : null,
        textContent: pageText
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // Проверка видимости элемента
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           el.offsetParent !== null;
  }
  
  // Генерация уникального селектора
  function generateSelector(el) {
    // ID (включая Gmail-специфичные с двоеточиями)
    if (el.id) return `#${el.id}`;
    if (el.name) return `[name="${el.name}"]`;
    
    // aria-label - очень надёжный селектор для Gmail
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.length < 60) {
      return `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
    }
    
    // data-tooltip для Gmail
    const tooltip = el.getAttribute('data-tooltip');
    if (tooltip && tooltip.length < 60) {
      return `[data-tooltip="${tooltip.replace(/"/g, '\\"')}"]`;
    }
    
    // Уникальный data-атрибут
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.value && attr.value.length < 50) {
        return `[${attr.name}="${attr.value.replace(/"/g, '\\"')}"]`;
      }
    }
    
    // По тексту для кнопок и ссылок
    const text = el.textContent?.trim();
    if (text && text.length < 50 && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button')) {
      const tag = el.tagName.toLowerCase();
      // Проверяем уникальность
      const matches = document.querySelectorAll(tag);
      for (let i = 0; i < matches.length; i++) {
        if (matches[i].textContent?.trim() === text) {
          if (matches[i] === el) {
            return `${tag}:has-text("${text.slice(0, 30)}")`;
          }
          break;
        }
      }
    }
    
    // CSS путь
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.split(' ').filter(c => c && !c.includes(':'));
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).join('.');
        }
      }
      path.unshift(selector);
      current = current.parentElement;
      if (path.length > 4) break;
    }
    return path.join(' > ');
  }
  
  // Защита от множественных кликов (глобальные переменные)
  let lastClickTime = 0;
  const CLICK_DEBOUNCE_MS = 1500; // Минимум 1.5 сек между кликами
  
  // Клик по элементу
  async function clickElement(selector) {
    console.log('[Bragent] clickElement called with:', selector);
    try {
      let el = null;
      
      // Определяем контекст поиска (модалка или весь документ)
      const modal = detectModal();
      const searchRoot = modal || document;
      console.log('[Bragent] Search root:', modal ? 'MODAL' : 'document');
      
      // Специальный синтаксис text: - поиск по тексту
      if (selector.startsWith('text:')) {
        const searchText = selector.slice(5); // убираем "text:"
        console.log('[Bragent] Searching for text:', searchText);
        
        // Универсальный поиск по тексту - без хардкода селекторов!
        // Приоритет: button > [role=button] > a > span/div
        const buttonSelectors = [
          'button',
          '[role="button"]',
          'a',
          '[onclick]',
          '[jsaction]'
        ];
        
        for (const btnSelector of buttonSelectors) {
          if (el) break;
          const buttons = searchRoot.querySelectorAll(btnSelector);
          for (const btn of buttons) {
            const btnText = btn.textContent?.trim() || '';
            const ariaLabel = btn.getAttribute('aria-label') || '';
            // Ищем ТОЧНОЕ совпадение или содержание текста
            if (btnText === searchText || ariaLabel === searchText || 
                (btnText.length < 50 && btnText.includes(searchText)) ||
                (ariaLabel.length < 50 && ariaLabel.includes(searchText))) {
              const rect = btn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                el = btn;
                console.log('[Bragent] Found button:', btnSelector, 'text:', btnText || ariaLabel);
                break;
              }
            }
          }
        }
        
        // Если не нашли кнопку, ищем leaf-элемент (span, div без детей) с текстом
        // ОПТИМИЗАЦИЯ: НЕ используем querySelectorAll('*') - это тяжело!
        if (!el) {
          const leafElements = searchRoot.querySelectorAll('span, div, p, label');
          for (const elem of leafElements) {
            const text = elem.textContent?.trim() || '';
            // Элемент должен содержать ТОЛЬКО наш текст (leaf node)
            if (text === searchText && elem.children.length === 0) {
              const rect = elem.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                // Кликаем на родителя если это span внутри кнопки
                el = elem.closest('[role="button"], button, [jsaction]') || elem;
                console.log('[Bragent] Found leaf element:', elem.tagName, 'clicking on:', el.tagName);
                break;
              }
            }
          }
        }
        
        // Fallback - ищем во всех кликабельных (внутри searchRoot)
        if (!el) {
          const allClickable = searchRoot.querySelectorAll('button, a, span, div, [role="button"], [role="link"], [jsaction]');
          for (const btn of allClickable) {
            const btnText = btn.textContent?.trim() || '';
            const ariaLabel = btn.getAttribute('aria-label') || '';
            if (btnText.includes(searchText) || ariaLabel.includes(searchText)) {
              const rect = btn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                el = btn;
                console.log('[Bragent] Fallback - found by text:', btnText || ariaLabel);
                break;
              }
            }
          }
        }
      }
      // Специальный синтаксис :has-text()
      else if (selector.includes(':has-text(')) {
        const match = selector.match(/^(\w+):has-text\("(.+)"\)$/);
        if (match) {
          const [, tag, text] = match;
          const elements = document.querySelectorAll(tag);
          for (const e of elements) {
            if (e.textContent?.trim().includes(text)) {
              el = e;
              break;
            }
          }
        }
        // Если не нашли с тегом, ищем везде
        if (!el) {
          const textMatch = selector.match(/:has-text\("(.+)"\)$/);
          if (textMatch) {
            const searchText = textMatch[1];
            // Ищем по aria-label
            el = document.querySelector(`[aria-label*="${searchText}"]`);
            // Ищем по тексту в кнопках
            if (!el) {
              const buttons = document.querySelectorAll('button, [role="button"], a, span');
              for (const btn of buttons) {
                if (btn.textContent?.trim().includes(searchText) || 
                    btn.getAttribute('aria-label')?.includes(searchText)) {
                  el = btn;
                  break;
                }
              }
            }
          }
        }
      } else if (selector.startsWith('#') && /[:#.]/.test(selector.slice(1))) {
        // ID с специальными символами (Gmail использует #:47 и т.п.)
        const id = selector.slice(1);
        console.log('[Bragent] Trying getElementById with:', id);
        el = document.getElementById(id);
      } else {
        try {
          el = document.querySelector(selector);
        } catch (e) {
          console.log('[Bragent] querySelector failed:', e.message);
          if (selector.startsWith('#')) {
            el = document.getElementById(selector.slice(1));
          }
        }
      }
      
      console.log('[Bragent] Element found:', !!el, el?.tagName);
      
      if (!el) {
        // Последняя попытка - поиск по тексту
        const allClickable = document.querySelectorAll('button, [role="button"], a, [onclick]');
        for (const btn of allClickable) {
          const btnText = btn.textContent?.trim() || btn.getAttribute('aria-label') || '';
          if (btnText.toLowerCase().includes(selector.toLowerCase().replace(/[^\w\sа-яё]/gi, ''))) {
            el = btn;
            console.log('[Bragent] Found by text search:', btnText);
            break;
          }
        }
      }
      
      if (!el) {
        return { success: false, error: `Элемент не найден: ${selector}` };
      }
      
      // Debounce - защита от слишком частых кликов
      const now = Date.now();
      if (now - lastClickTime < CLICK_DEBOUNCE_MS) {
        console.log('[Bragent] Click debounced, waiting...');
        await new Promise(r => setTimeout(r, CLICK_DEBOUNCE_MS - (now - lastClickTime)));
      }
      lastClickTime = Date.now();
      
      // ВАЖНО: Убираем target="_blank" чтобы не открывались новые вкладки
      if (el.tagName === 'A' && el.getAttribute('target') === '_blank') {
        el.removeAttribute('target');
        console.log('[Bragent] Removed target="_blank" from link');
      }
      // Также проверяем ссылки внутри элемента
      const innerLinks = el.querySelectorAll('a[target="_blank"]');
      innerLinks.forEach(link => {
        link.removeAttribute('target');
        console.log('[Bragent] Removed target="_blank" from inner link');
      });
      
      // Скролл к элементу
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Ждём завершения скролла
      await new Promise(r => setTimeout(r, 100));
      
      // Фокус на элементе (важно для Gmail!)
      if (typeof el.focus === 'function') {
        el.focus();
      }
      
      // Получаем координаты центра элемента
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      
      // ОДИН клик - нативный метод (самый надёжный)
      // Не отправляем множество событий - это ломает модальные окна!
      if (typeof el.click === 'function') {
        el.click();
        console.log('[Bragent] Native click dispatched');
      } else {
        // Fallback для элементов без .click()
        const event = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0
        });
        el.dispatchEvent(event);
        console.log('[Bragent] MouseEvent click dispatched');
      }
      
      console.log('[Bragent] Click dispatched on', el.tagName, el.id || el.className, 'role:', el.getAttribute('role'));
      
      // Ждём после клика чтобы страница успела отреагировать (модалка, навигация и т.д.)
      await new Promise(r => setTimeout(r, 500));
      
      return { success: true, message: `Клик по: ${selector}` };
    } catch (error) {
      console.error('[Bragent] clickElement error:', error);
      return { success: false, error: error.message };
    }
  }
  
  // Ввод текста
  function typeText(selector, value) {
    try {
      const el = document.querySelector(selector);
      if (!el) {
        return { success: false, error: `Элемент не найден: ${selector}` };
      }
      
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
      el.value = value;
      
      // Триггерим события
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      
      return { success: true, message: `Введено "${value}" в ${selector}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // Скролл страницы
  function scrollPage(direction, amount = 500) {
    try {
      // Не скроллим если открыто модальное окно
      const modal = detectModal();
      if (modal) {
        console.log('[Bragent] Scroll blocked - modal is open');
        return { success: true, message: `Скролл пропущен - открыто модальное окно. Используй элементы внутри него.` };
      }
      
      const scrollAmount = direction === 'down' ? amount : -amount;
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      return { success: true, message: `Скролл ${direction} на ${amount}px` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // Извлечение текста со страницы
  function extractText(selector, maxLength = 2000) {
    try {
      let text = '';
      
      if (selector) {
        // Извлекаем текст из конкретного элемента
        const el = document.querySelector(selector);
        if (el) {
          text = el.innerText || el.textContent || '';
        } else {
          return { success: false, error: `Элемент не найден: ${selector}` };
        }
      } else {
        // Извлекаем основной контент страницы
        // Пробуем найти основной контент
        const mainSelectors = [
          'main', 'article', '[role="main"]', '.content', '#content',
          '.feed', '.news-feed', '.post', '.wall_posts'
        ];
        
        for (const sel of mainSelectors) {
          const el = document.querySelector(sel);
          if (el && el.innerText?.length > 100) {
            text = el.innerText;
            break;
          }
        }
        
        // Если ничего не нашли - берём body
        if (!text) {
          text = document.body?.innerText || '';
        }
      }
      
      // Очищаем и обрезаем
      text = text.replace(/\s+/g, ' ').trim();
      if (text.length > maxLength) {
        text = text.slice(0, maxLength) + '...';
      }
      
      return { success: true, text };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  console.log('[Bragent] Content script загружен');
})();
