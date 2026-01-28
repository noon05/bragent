// Background Service Worker для Bragent Extension
// Управляет браузером через chrome.* API с Long-Polling

const API_BASE = 'http://localhost:3000';
let isConnected = false;
let pollAbortController = null;

// Открываем Side Panel по клику на иконку
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Включаем Side Panel для всех вкладок
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ==================== Long Polling ====================

async function startPolling() {
  console.log('[Bragent] Запуск polling...');
  
  while (true) {
    try {
      pollAbortController = new AbortController();
      
      // Регистрируемся и ждём команду (long poll)
      const response = await fetch(`${API_BASE}/api/extension/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          extensionId: chrome.runtime.id,
          ready: true 
        }),
        signal: pollAbortController.signal
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const command = await response.json();
      
      if (!isConnected) {
        isConnected = true;
        updateBadge('ON', '#00b894');
        console.log('[Bragent] ✅ Подключено к серверу');
      }
      
      // Если есть команда - выполняем
      if (command && command.type) {
        console.log('[Bragent] Команда:', command.type, command.id);
        let result;
        try {
          result = await handleCommand(command);
          console.log('[Bragent] Результат команды:', command.id, result?.success);
        } catch (cmdError) {
          console.error('[Bragent] Ошибка выполнения команды:', cmdError);
          result = { success: false, error: cmdError.message };
        }
        
        // Отправляем результат
        try {
          await fetch(`${API_BASE}/api/extension/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: command.id,
              result: result
            })
          });
          console.log('[Bragent] Результат отправлен:', command.id);
        } catch (sendError) {
          console.error('[Bragent] Ошибка отправки результата:', sendError);
        }
      }
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[Bragent] Polling остановлен');
        break;
      }
      
      if (isConnected) {
        isConnected = false;
        updateBadge('OFF', '#d63031');
        console.log('[Bragent] ❌ Сервер недоступен');
      }
      
      // Ждём перед повторной попыткой
      await sleep(3000);
    }
  }
}

function stopPolling() {
  if (pollAbortController) {
    pollAbortController.abort();
    pollAbortController = null;
  }
}

// ==================== Обработка команд ====================

async function handleCommand(command) {
  try {
    // Поддержка формата EXECUTE_ACTION с вложенным action
    if (command.type === 'EXECUTE_ACTION' && command.action) {
      return await handleCommand({ ...command.action, id: command.id });
    }
    
    // Поддержка формата GET_PAGE_CONTEXT
    if (command.type === 'GET_PAGE_CONTEXT') {
      return await getPageContext();
    }
    
    switch (command.type) {
      case 'navigate':
        return await navigateTo(command.url);
      
      case 'click':
        return await executeInContent('click', { selector: command.selector });
      
      case 'type_text':
        return await executeInContent('type', { 
          selector: command.selector, 
          value: command.text 
        });
      
      case 'wait':
        const ms = command.amount || command.milliseconds || 1000;
        await new Promise(resolve => setTimeout(resolve, ms));
        return { success: true, message: `Ожидание ${ms}мс` };
      
      case 'scroll':
        return await executeInContent('scroll', { 
          direction: command.direction || 'down', 
          amount: command.amount || 500 
        });
      
      case 'press_key':
        return await executeInContent('pressKey', { key: command.key });
      
      case 'extract_text':
        return await executeInContent('extractText', { 
          selector: command.selector,
          maxLength: command.maxLength || 2000
        });
      
      case 'get_page_context':
        return await getPageContext();
      
      case 'screenshot':
        return await takeScreenshot();
      
      case 'go_back':
        return await goBack();
      
      case 'go_forward':
        return await goForward();
      
      case 'refresh':
        return await refresh();
      
      default:
        return { success: false, error: `Неизвестная команда: ${command.type}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ==================== Браузерные действия ====================

async function navigateTo(url) {
  const tab = await getActiveTab();
  if (!tab) return { success: false, error: 'Нет активной вкладки' };
  
  await chrome.tabs.update(tab.id, { url });
  await waitForTabLoad(tab.id);
  
  return { success: true, message: `Переход на ${url}` };
}

async function goBack() {
  const tab = await getActiveTab();
  if (!tab) return { success: false, error: 'Нет активной вкладки' };
  
  await chrome.tabs.goBack(tab.id);
  await waitForTabLoad(tab.id);
  
  return { success: true, message: 'Назад' };
}

async function goForward() {
  const tab = await getActiveTab();
  if (!tab) return { success: false, error: 'Нет активной вкладки' };
  
  await chrome.tabs.goForward(tab.id);
  await waitForTabLoad(tab.id);
  
  return { success: true, message: 'Вперёд' };
}

async function refresh() {
  const tab = await getActiveTab();
  if (!tab) return { success: false, error: 'Нет активной вкладки' };
  
  await chrome.tabs.reload(tab.id);
  await waitForTabLoad(tab.id);
  
  return { success: true, message: 'Страница обновлена' };
}

async function takeScreenshot() {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    return { success: true, screenshot: dataUrl };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getPageContext() {
  const tab = await getActiveTab();
  if (!tab) {
    return { 
      success: false, 
      error: 'Нет активной вкладки',
      url: '', title: '', elements: [], forms: []
    };
  }
  
  // Проверяем системные страницы
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://') || tab.url?.startsWith('about:')) {
    return {
      success: true,
      url: tab.url,
      title: tab.title || 'Системная страница',
      elements: [],
      forms: [],
      textContent: 'Это системная страница браузера. Выполните navigate для перехода на нужный сайт.'
    };
  }
  
  try {
    const result = await executeInContent('getPageContext', {});
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message,
      url: tab.url || '',
      title: tab.title || '',
      elements: [],
      forms: []
    };
  }
}

// ==================== Работа с content script ====================

async function executeInContent(action, data) {
  const tab = await getActiveTab();
  if (!tab) return { success: false, error: 'Нет активной вкладки' };
  
  // Проверяем системные страницы
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://')) {
    return { success: false, error: 'Нельзя управлять системными страницами' };
  }
  
  try {
    // Инжектим content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (e) {
    // Может быть уже загружен
  }
  
  // Небольшая задержка для инициализации
  await sleep(100);
  
  // Отправляем сообщение с таймаутом (увеличен до 15 сек)
  try {
    console.log('[Bragent] Sending to content script:', action, JSON.stringify(data).slice(0, 100));
    const result = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { action, ...data }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout: content script не ответил за 15 сек')), 15000))
    ]);
    console.log('[Bragent] Content script response:', JSON.stringify(result).slice(0, 100));
    return result || { success: true, message: 'Действие выполнено' };
  } catch (err) {
    console.error('[Bragent] executeInContent error:', err.message);
    // Если content script не отвечает, пробуем переинжектить
    if (err.message.includes('Receiving end does not exist') || err.message.includes('Timeout')) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await sleep(200);
        const retryResult = await chrome.tabs.sendMessage(tab.id, { action, ...data });
        return retryResult || { success: true, message: 'Действие выполнено (retry)' };
      } catch (retryErr) {
        return { success: false, error: `Retry failed: ${retryErr.message}` };
      }
    }
    return { success: false, error: err.message };
  }
}

// ==================== Утилиты ====================

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);
    
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 500);
      }
    };
    
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updateBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ==================== Обработка сообщений от popup ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (request.type === 'GET_STATUS') {
      sendResponse({ connected: isConnected });
    } else if (request.type === 'SEND_TASK') {
      try {
        const response = await fetch(`${API_BASE}/api/task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: request.task })
        });
        const data = await response.json();
        sendResponse({ success: true, data });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    } else if (request.type === 'STOP_TASK') {
      try {
        await fetch(`${API_BASE}/api/stop`, { method: 'POST' });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    }
  })();
  return true;
});

// ==================== Запуск ====================

console.log('[Bragent] 🚀 Background service worker запущен');
updateBadge('...', '#636e72');
startPolling();

// Keepalive - предотвращаем засыпание service worker
setInterval(() => {
  chrome.storage.local.set({ keepalive: Date.now() });
}, 20000);
