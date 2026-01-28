import 'dotenv/config';
import { WebServer } from './server/index.js';
import { AgentConfig } from './types/index.js';
import chalk from 'chalk';
import boxen from 'boxen';
import gradient from 'gradient-string';
import figlet from 'figlet';

async function main() {
  // Показываем баннер
  console.clear();
  
  const banner = figlet.textSync('BRAGENT', {
    font: 'ANSI Shadow',
    horizontalLayout: 'fitted'
  });

  console.log(gradient(['#6C5CE7', '#A29BFE', '#74B9FF'])(banner));
  
  console.log(
    boxen(
      chalk.hex('#DFE6E9')(
        '🤖 AI Browser Agent\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
        'Автономный агент для управления браузером\n' +
        'Powered by Claude/GPT через OpenRouter'
      ),
      {
        padding: 1,
        margin: { top: 0, bottom: 1, left: 2, right: 2 },
        borderStyle: 'round',
        borderColor: '#6C5CE7',
        backgroundColor: '#1E272E'
      }
    )
  );

  // Определяем модель и API ключ
  const model = process.env.AI_MODEL || 'gemini/gemini-2.0-flash';
  const isZhipuAI = model.startsWith('zhipu/');
  const isAnthropic = model.startsWith('claude/');
  const isG4F = model.startsWith('g4f/');
  const isGemini = model.startsWith('gemini/');
  const isGroq = model.startsWith('groq/');
  
  // Выбираем API ключ в зависимости от провайдера
  let apiKey: string;
  if (isGemini) {
    // Google Gemini - БЕСПЛАТНО! 15 запросов/мин
    apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      console.log(chalk.red('❌ GEMINI_API_KEY не найден в .env файле!'));
      console.log(chalk.yellow('Получи бесплатный ключ: https://aistudio.google.com/apikey'));
      process.exit(1);
    }
    console.log(chalk.green('🆓 Провайдер: Google Gemini (БЕСПЛАТНО!)'));
  } else if (isGroq) {
    // Groq - БЕСПЛАТНО! Очень быстрый
    apiKey = process.env.GROQ_API_KEY || '';
    if (!apiKey) {
      console.log(chalk.red('❌ GROQ_API_KEY не найден в .env файле!'));
      console.log(chalk.yellow('Получи бесплатный ключ: https://console.groq.com/keys'));
      process.exit(1);
    }
    console.log(chalk.green('🆓 Провайдер: Groq (БЕСПЛАТНО, очень быстрый!)'));
  } else if (isG4F) {
    // GPT4Free - не требует API ключ (БЕСПЛАТНО!)
    apiKey = 'not-needed';
    console.log(chalk.green('🆓 Провайдер: GPT4Free (БЕСПЛАТНО!)'));
    console.log(chalk.yellow('ℹ️  Убедись что g4f запущен: python -m g4f.cli api --port 8080'));
  } else if (isZhipuAI) {
    apiKey = process.env.ZHIPUAI_API_KEY || '';
    if (!apiKey) {
      console.log(chalk.red('❌ ZHIPUAI_API_KEY не найден в .env файле!'));
      console.log(chalk.yellow('Создайте .env файл с вашим API ключом ZhipuAI'));
      process.exit(1);
    }
    console.log(chalk.cyan('🤖 Провайдер: ZhipuAI (GLM)'));
  } else if (isAnthropic) {
    apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) {
      console.log(chalk.red('❌ ANTHROPIC_API_KEY не найден в .env файле!'));
      console.log(chalk.yellow('Создайте .env файл с вашим API ключом Anthropic'));
      process.exit(1);
    }
    console.log(chalk.cyan('🤖 Провайдер: Anthropic (Claude)'));
  } else {
    apiKey = process.env.OPENROUTER_API_KEY || '';
    if (!apiKey) {
      console.log(chalk.red('❌ OPENROUTER_API_KEY не найден в .env файле!'));
      console.log(chalk.yellow('Создайте .env файл с вашим API ключом OpenRouter'));
      process.exit(1);
    }
    console.log(chalk.cyan('🤖 Провайдер: OpenRouter'));
  }

  // Конфигурация агента
  const browserType = (process.env.BROWSER_TYPE || 'chromium') as 'chromium' | 'chrome' | 'yandex' | 'firefox' | 'edge';
  
  const config: AgentConfig = {
    apiKey,
    model,
    maxTokens: 8000,
    maxIterations: parseInt(process.env.MAX_ITERATIONS || '30'),
    browserHeadless: process.env.BROWSER_HEADLESS === 'true',
    browserSlowMo: parseInt(process.env.BROWSER_SLOW_MO || '50'),
    userDataDir: process.env.USER_DATA_DIR || './browser-data',
    browserType,
    customBrowserPath: process.env.YANDEX_BROWSER_PATH
  };

  console.log(chalk.hex('#74B9FF')(`💡 Модель: ${config.model}`));
  console.log(chalk.hex('#74B9FF')(`💡 Браузер: ${config.browserType}`));
  console.log(chalk.hex('#74B9FF')(`💡 Макс. итераций: ${config.maxIterations}`));
  console.log('');

  // Создаём и запускаем веб-сервер
  const server = new WebServer(config);
  
  const PORT = parseInt(process.env.PORT || '3000');
  
  console.log(chalk.hex('#A29BFE')('🚀 Инициализация браузера...'));
  
  try {
    await server.initAgent();
    server.start(PORT);
    
    console.log(chalk.hex('#00B894')('✅ Браузер запущен!'));
    console.log('');
    console.log(
      boxen(
        chalk.hex('#DFE6E9')(
          `🌐 Откройте в браузере:\n\n` +
          chalk.hex('#6C5CE7').bold(`   http://localhost:${PORT}`)
        ),
        {
          padding: 1,
          margin: { left: 2 },
          borderStyle: 'round',
          borderColor: '#00B894',
          backgroundColor: '#1E272E'
        }
      )
    );
    
  } catch (error) {
    console.log(chalk.red(`❌ Ошибка запуска: ${error}`));
    process.exit(1);
  }

  // Обработка завершения
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n⚠️ Получен сигнал завершения...'));
    await server.close();
    console.log(chalk.hex('#6C5CE7')('👋 До встречи!'));
    process.exit(0);
  });
}

// Запуск
main().catch(error => {
  console.error('Критическая ошибка:', error);
  process.exit(1);
});
