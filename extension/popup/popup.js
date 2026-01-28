// Bragent Extension - Popup Script

const API_BASE = 'http://localhost:3000';

console.log('Bragent popup loaded');

// DOM Elements
const elements = {
  statusIndicator: document.getElementById('statusIndicator'),
  chatContainer: document.getElementById('chatContainer'),
  welcomeMessage: document.getElementById('welcomeMessage'),
  messages: document.getElementById('messages'),
  taskInput: document.getElementById('taskInput'),
  sendBtn: document.getElementById('sendBtn'),
  stopBtn: document.getElementById('stopBtn'),
  securityPrompt: document.getElementById('securityPrompt'),
  securityText: document.getElementById('securityText'),
  securityApprove: document.getElementById('securityApprove'),
  securityDeny: document.getElementById('securityDeny'),
  userInputPrompt: document.getElementById('userInputPrompt'),
  inputQuestion: document.getElementById('inputQuestion'),
  userInputField: document.getElementById('userInputField'),
  submitInput: document.getElementById('submitInput')
};

console.log('Elements:', elements);

let eventSource = null;
let isRunning = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded');
  init();
  setupEventListeners();
});

async function init() {
  console.log('Init started');
  // Check server status
  await checkStatus();
  
  // Connect to SSE
  connectSSE();
}

function setupEventListeners() {
  // Send button
  elements.sendBtn.addEventListener('click', sendTask);
  
  // Enter to send (Shift+Enter for new line)
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
  
  // Example buttons
  document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      elements.taskInput.value = btn.dataset.task;
      sendTask();
    });
  });
  
  // Stop button
  elements.stopBtn.addEventListener('click', stopTask);
  
  // Security responses
  elements.securityApprove.addEventListener('click', () => handleSecurityResponse(true));
  elements.securityDeny.addEventListener('click', () => handleSecurityResponse(false));
  
  // User input
  elements.submitInput.addEventListener('click', submitUserInput);
  elements.userInputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitUserInput();
  });
}

async function checkStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/status`);
    if (response.ok) {
      const data = await response.json();
      updateStatus('connected', 'Подключено');
      isRunning = data.isRunning;
      updateUIState();
    } else {
      throw new Error('Server error');
    }
  } catch (error) {
    updateStatus('error', 'Сервер недоступен');
    console.error('Status check failed:', error);
  }
}

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }
  
  eventSource = new EventSource(`${API_BASE}/events`);
  
  eventSource.onopen = () => {
    updateStatus('connected', 'Подключено');
  };
  
  eventSource.onerror = () => {
    updateStatus('error', 'Нет связи');
    setTimeout(connectSSE, 5000);
  };
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSSEEvent(data);
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };
}

function handleSSEEvent(data) {
  switch (data.event) {
    case 'log':
      addLogMessage(data.data);
      break;
    case 'taskStart':
      isRunning = true;
      updateStatus('running', 'Выполняется...');
      updateUIState();
      break;
    case 'taskComplete':
      isRunning = false;
      updateStatus('connected', 'Готово');
      updateUIState();
      addResultMessage(data.data);
      break;
    case 'securityPrompt':
      showSecurityPrompt(data.data.warning);
      break;
    case 'userInput':
      showUserInputPrompt(data.data.question);
      break;
  }
}

function updateStatus(state, text) {
  elements.statusIndicator.className = `status-indicator ${state}`;
  elements.statusIndicator.querySelector('.status-text').textContent = text;
}

function updateUIState() {
  elements.sendBtn.disabled = isRunning;
  elements.stopBtn.classList.toggle('hidden', !isRunning);
}

async function sendTask() {
  const task = elements.taskInput.value.trim();
  if (!task || isRunning) return;
  
  // Hide welcome, show messages
  elements.welcomeMessage.classList.add('hidden');
  
  // Add user message
  addMessage('user', task);
  
  // Clear input
  elements.taskInput.value = '';
  elements.taskInput.style.height = 'auto';
  
  // Show typing indicator
  addTypingIndicator();
  
  try {
    const response = await fetch(`${API_BASE}/api/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send task');
    }
  } catch (error) {
    removeTypingIndicator();
    addMessage('assistant', `❌ Ошибка: ${error.message}`, 'error');
  }
}

async function stopTask() {
  try {
    await fetch(`${API_BASE}/api/stop`, { method: 'POST' });
  } catch (error) {
    console.error('Stop failed:', error);
  }
}

function addMessage(role, content, type = '') {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role} ${type}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? '👤' : '🤖';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = content;
  
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentDiv);
  
  elements.messages.appendChild(messageDiv);
  scrollToBottom();
}

function addLogMessage(log) {
  removeTypingIndicator();
  
  const icons = {
    info: 'ℹ️',
    action: '⚡',
    thought: '💭',
    error: '❌',
    success: '✅',
    warning: '⚠️'
  };
  
  const icon = icons[log.type] || 'ℹ️';
  addMessage('assistant', `${icon} ${log.message}`, log.type);
}

function addResultMessage(result) {
  if (result.success) {
    addMessage('assistant', `✅ Задача выполнена!\n${result.summary}`, 'success');
  } else {
    addMessage('assistant', `❌ Не удалось выполнить задачу\n${result.summary}`, 'error');
  }
}

function addTypingIndicator() {
  const existing = document.querySelector('.typing-indicator');
  if (existing) return;
  
  const indicator = document.createElement('div');
  indicator.className = 'message assistant';
  indicator.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="typing-indicator">
      <span></span><span></span><span></span>
    </div>
  `;
  elements.messages.appendChild(indicator);
  scrollToBottom();
}

function removeTypingIndicator() {
  const indicator = document.querySelector('.typing-indicator');
  if (indicator) {
    indicator.parentElement.remove();
  }
}

function scrollToBottom() {
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

function showSecurityPrompt(warning) {
  elements.securityText.textContent = warning;
  elements.securityPrompt.classList.remove('hidden');
}

async function handleSecurityResponse(approved) {
  elements.securityPrompt.classList.add('hidden');
  
  try {
    await fetch(`${API_BASE}/api/security-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved })
    });
  } catch (error) {
    console.error('Security response failed:', error);
  }
}

function showUserInputPrompt(question) {
  elements.inputQuestion.textContent = question;
  elements.userInputPrompt.classList.remove('hidden');
  elements.userInputField.focus();
}

async function submitUserInput() {
  const value = elements.userInputField.value.trim();
  if (!value) return;
  
  elements.userInputPrompt.classList.add('hidden');
  elements.userInputField.value = '';
  
  try {
    await fetch(`${API_BASE}/api/user-input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
  } catch (error) {
    console.error('User input failed:', error);
  }
}

// Cleanup on close
window.addEventListener('beforeunload', () => {
  if (eventSource) {
    eventSource.close();
  }
});
