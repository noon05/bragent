// Bragent Side Panel - JavaScript

const API_BASE = 'http://localhost:3000';

// DOM Elements
const elements = {
  statusBadge: document.getElementById('statusBadge'),
  chatArea: document.getElementById('chatArea'),
  welcome: document.getElementById('welcome'),
  messages: document.getElementById('messages'),
  taskInput: document.getElementById('taskInput'),
  sendBtn: document.getElementById('sendBtn'),
  stopBtn: document.getElementById('stopBtn')
};

let eventSource = null;
let isRunning = false;

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await checkStatus();
  connectSSE();
  setupEventListeners();
}

function setupEventListeners() {
  // Send task
  elements.sendBtn.addEventListener('click', sendTask);
  
  // Enter to send
  elements.taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTask();
    }
  });
  
  // Auto-resize textarea
  elements.taskInput.addEventListener('input', () => {
    elements.taskInput.style.height = 'auto';
    elements.taskInput.style.height = Math.min(elements.taskInput.scrollHeight, 120) + 'px';
  });
  
  // Quick action buttons
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      elements.taskInput.value = btn.dataset.task;
      sendTask();
    });
  });
  
  // Stop button
  elements.stopBtn.addEventListener('click', stopTask);
}

async function checkStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/status`);
    if (response.ok) {
      const data = await response.json();
      updateStatus('connected');
      isRunning = data.isRunning;
      updateUI();
      
      // Show existing logs
      if (data.logs && data.logs.length > 0) {
        elements.welcome.classList.add('hidden');
        data.logs.forEach(log => addMessage(log.message, log.type));
      }
      
      // Показать ожидающий security prompt если есть
      if (data.pendingSecurityPrompt) {
        showSecurityPrompt(data.pendingSecurityPrompt);
      }
    }
  } catch (error) {
    updateStatus('error');
    console.error('Status check failed:', error);
  }
}

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }
  
  eventSource = new EventSource(`${API_BASE}/api/events`);
  
  eventSource.onopen = () => {
    updateStatus('connected');
  };
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleEvent(data);
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };
  
  eventSource.onerror = () => {
    updateStatus('error');
    setTimeout(connectSSE, 3000);
  };
}

function handleEvent(data) {
  switch (data.event) {
    case 'log':
      addMessage(data.data.message, data.data.type);
      break;
    case 'taskStart':
      isRunning = true;
      updateUI();
      addMessage(data.data.task, 'user');
      break;
    case 'taskComplete':
      isRunning = false;
      updateUI();
      // Показываем результат только один раз
      const emoji = data.data.success ? '✅' : '❌';
      addMessage(emoji + ' ' + (data.data.summary || 'Задача завершена'), data.data.success ? 'success' : 'error');
      break;
    case 'securityPrompt':
      // Показываем запрос подтверждения безопасности
      showSecurityPrompt(data.data.warning);
      break;
    case 'extensionConnected':
      updateStatus('connected');
      addMessage('🔌 Расширение подключено', 'action');
      break;
    case 'extensionDisconnected':
      addMessage('⚠️ Расширение отключено', 'error');
      break;
  }
}

async function sendTask() {
  const task = elements.taskInput.value.trim();
  if (!task || isRunning) return;
  
  elements.taskInput.value = '';
  elements.taskInput.style.height = 'auto';
  elements.welcome.classList.add('hidden');
  
  try {
    const response = await fetch(`${API_BASE}/api/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task })
    });
    
    if (!response.ok) {
      const error = await response.json();
      addMessage('❌ ' + (error.error || 'Ошибка отправки'), 'error');
    }
  } catch (error) {
    addMessage('❌ Сервер недоступен', 'error');
  }
}

async function stopTask() {
  try {
    await fetch(`${API_BASE}/api/stop`, { method: 'POST' });
    isRunning = false;
    updateUI();
    addMessage('⏹ Остановлено', 'action');
  } catch (error) {
    console.error('Stop failed:', error);
  }
}

function addMessage(text, type = 'info') {
  // Skip certain log types
  if (type === 'info' && (text.includes('Отправляю запрос') || text.includes('Инициализация'))) {
    return;
  }
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  
  // Для confirm типа добавляем кнопки
  if (type === 'confirm') {
    const questionText = text.replace('⚠️ ПОДТВЕРЖДЕНИЕ: ', '');
    messageDiv.innerHTML = `
      <div class="confirm-question">${questionText}</div>
      <div class="confirm-buttons">
        <button class="confirm-btn confirm-yes" data-answer="Да, подтверждаю">✓ Да</button>
        <button class="confirm-btn confirm-no" data-answer="Нет, отменить">✗ Нет</button>
      </div>
    `;
    
    // Обработчики кнопок
    messageDiv.querySelectorAll('.confirm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const answer = btn.dataset.answer;
        sendUserResponse(answer);
        // Заменяем кнопки на ответ
        messageDiv.innerHTML = `<div class="confirm-answered">${answer}</div>`;
        messageDiv.className = 'message action';
      });
    });
  } else {
    messageDiv.textContent = text;
  }
  
  elements.messages.appendChild(messageDiv);
  elements.chatArea.scrollTop = elements.chatArea.scrollHeight;
}

async function sendUserResponse(answer) {
  try {
    await fetch(`${API_BASE}/api/user-input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer })
    });
  } catch (error) {
    console.error('Failed to send response:', error);
  }
}
function updateStatus(status) {
  const statusText = elements.statusBadge.querySelector('.status-text');
  elements.statusBadge.className = 'status-badge';
  
  switch (status) {
    case 'connected':
      elements.statusBadge.classList.add('connected');
      statusText.textContent = 'Подключено';
      break;
    case 'error':
      elements.statusBadge.classList.add('error');
      statusText.textContent = 'Нет связи';
      break;
    default:
      statusText.textContent = 'Подключение...';
  }
}

function updateUI() {
  if (isRunning) {
    elements.sendBtn.disabled = true;
    elements.stopBtn.classList.add('visible');
  } else {
    elements.sendBtn.disabled = false;
    elements.stopBtn.classList.remove('visible');
  }
}

// Показать запрос подтверждения безопасности
function showSecurityPrompt(warning) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message security-prompt';
  messageDiv.innerHTML = `
    <div class="security-warning">⚠️ ПОДТВЕРЖДЕНИЕ ДЕЙСТВИЯ</div>
    <div class="security-text">${warning}</div>
    <div class="confirm-buttons">
      <button class="confirm-btn confirm-yes security-allow">✓ Разрешить</button>
      <button class="confirm-btn confirm-no security-deny">✗ Запретить</button>
    </div>
  `;
  
  // Обработчики кнопок
  const allowBtn = messageDiv.querySelector('.security-allow');
  const denyBtn = messageDiv.querySelector('.security-deny');
  
  allowBtn.addEventListener('click', () => {
    sendSecurityResponse(true);
    messageDiv.innerHTML = '<div class="confirm-answered">✅ Действие разрешено</div>';
    messageDiv.className = 'message action';
  });
  
  denyBtn.addEventListener('click', () => {
    sendSecurityResponse(false);
    messageDiv.innerHTML = '<div class="confirm-answered">❌ Действие запрещено</div>';
    messageDiv.className = 'message error';
  });
  
  elements.messages.appendChild(messageDiv);
  elements.chatArea.scrollTop = elements.chatArea.scrollHeight;
}

// Отправить ответ на security prompt
async function sendSecurityResponse(approved) {
  try {
    await fetch(`${API_BASE}/api/security-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved })
    });
  } catch (error) {
    console.error('Failed to send security response:', error);
  }
}
