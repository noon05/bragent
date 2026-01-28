import chalk from 'chalk';
import ora, { Ora } from 'ora';
import inquirer from 'inquirer';
import boxen from 'boxen';
import gradient from 'gradient-string';
import figlet from 'figlet';
import { TaskResult } from '../types/index.js';

/**
 * CLI Interface - красивый терминальный интерфейс в стиле Soft UI / Neomorphism
 */
export class CLIInterface {
  private spinner: Ora | null = null;
  
  // Цветовая палитра для dark neomorphism
  private colors = {
    primary: '#6C5CE7',
    secondary: '#A29BFE',
    success: '#00B894',
    warning: '#FDCB6E',
    error: '#E17055',
    info: '#74B9FF',
    text: '#DFE6E9',
    dim: '#636E72',
    bg: '#2D3436'
  };

  constructor() {}

  /**
   * Показывает красивый баннер при запуске
   */
  showBanner(): void {
    console.clear();
    
    const banner = figlet.textSync('BRAGENT', {
      font: 'ANSI Shadow',
      horizontalLayout: 'fitted'
    });

    const gradientBanner = gradient(['#6C5CE7', '#A29BFE', '#74B9FF'])(banner);
    console.log(gradientBanner);
    
    console.log(
      boxen(
        chalk.hex(this.colors.text)(
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
  }

  /**
   * Запрашивает задачу у пользователя
   */
  async promptTask(): Promise<string> {
    console.log('');
    const { task } = await inquirer.prompt([
      {
        type: 'input',
        name: 'task',
        message: chalk.hex(this.colors.primary)('📝 Введите задачу для агента:'),
        prefix: chalk.hex(this.colors.secondary)('➤'),
        validate: (input) => input.trim().length > 0 || 'Введите задачу'
      }
    ]);
    console.log('');
    return task;
  }

  /**
   * Запрашивает подтверждение у пользователя
   */
  async promptConfirmation(message: string): Promise<boolean> {
    this.stopSpinner();
    
    console.log(
      boxen(message, {
        padding: 1,
        borderStyle: 'round',
        borderColor: '#E17055',
        backgroundColor: '#1E272E',
        title: '⚠️ Подтверждение',
        titleAlignment: 'center'
      })
    );

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: chalk.hex(this.colors.warning)('Продолжить?'),
        default: false
      }
    ]);
    
    return confirmed;
  }

  /**
   * Запрашивает ввод пользователя
   */
  async promptUserInput(question: string): Promise<string> {
    this.stopSpinner();
    
    console.log(
      boxen(question, {
        padding: 1,
        borderStyle: 'round',
        borderColor: '#74B9FF',
        backgroundColor: '#1E272E',
        title: '❓ Вопрос от агента',
        titleAlignment: 'center'
      })
    );

    const { answer } = await inquirer.prompt([
      {
        type: 'input',
        name: 'answer',
        message: chalk.hex(this.colors.info)('Ваш ответ:'),
        prefix: chalk.hex(this.colors.secondary)('➤')
      }
    ]);
    
    return answer;
  }

  /**
   * Логирует сообщение с соответствующим стилем
   */
  log(message: string, type: 'info' | 'action' | 'thought' | 'error' | 'success' | 'warning'): void {
    this.stopSpinner();
    
    const timestamp = chalk.hex(this.colors.dim)(
      `[${new Date().toLocaleTimeString()}]`
    );

    let formattedMessage: string;
    let icon: string;

    switch (type) {
      case 'info':
        icon = '💡';
        formattedMessage = chalk.hex(this.colors.info)(message);
        break;
      case 'action':
        icon = '⚡';
        formattedMessage = chalk.hex(this.colors.primary)(message);
        break;
      case 'thought':
        icon = '💭';
        formattedMessage = chalk.hex(this.colors.secondary).italic(message);
        break;
      case 'error':
        icon = '❌';
        formattedMessage = chalk.hex(this.colors.error)(message);
        break;
      case 'success':
        icon = '✅';
        formattedMessage = chalk.hex(this.colors.success).bold(message);
        break;
      case 'warning':
        icon = '⚠️';
        formattedMessage = chalk.hex(this.colors.warning)(message);
        break;
      default:
        icon = '📌';
        formattedMessage = chalk.hex(this.colors.text)(message);
    }

    console.log(`${timestamp} ${icon} ${formattedMessage}`);
  }

  /**
   * Показывает спиннер загрузки
   */
  startSpinner(text: string): void {
    this.spinner = ora({
      text: chalk.hex(this.colors.secondary)(text),
      spinner: 'dots12',
      color: 'magenta'
    }).start();
  }

  /**
   * Останавливает спиннер
   */
  stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  /**
   * Показывает результат выполнения задачи
   */
  showTaskResult(result: TaskResult): void {
    this.stopSpinner();
    
    const statusIcon = result.success ? '✅' : '❌';
    const statusColor = result.success ? this.colors.success : this.colors.error;
    const statusText = result.success ? 'УСПЕШНО' : 'НЕ УДАЛОСЬ';

    const duration = (result.duration / 1000).toFixed(2);
    
    let content = `${statusIcon} Статус: ${chalk.hex(statusColor).bold(statusText)}\n\n`;
    content += `📋 Результат:\n${chalk.hex(this.colors.text)(result.summary)}\n\n`;
    content += `⚡ Выполнено действий: ${chalk.hex(this.colors.primary)(result.actions.length.toString())}\n`;
    content += `⏱️ Время: ${chalk.hex(this.colors.info)(duration + 's')}`;

    if (result.errors.length > 0) {
      content += `\n\n${chalk.hex(this.colors.error)('Ошибки:')}\n`;
      result.errors.forEach(err => {
        content += `  • ${chalk.hex(this.colors.dim)(err)}\n`;
      });
    }

    console.log('');
    console.log(
      boxen(content, {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: result.success ? '#00B894' : '#E17055',
        backgroundColor: '#1E272E',
        title: '📊 Отчёт о выполнении',
        titleAlignment: 'center'
      })
    );
  }

  /**
   * Показывает меню действий
   */
  async showMenu(): Promise<'task' | 'exit'> {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: chalk.hex(this.colors.primary)('Что будем делать?'),
        prefix: chalk.hex(this.colors.secondary)('➤'),
        choices: [
          {
            name: chalk.hex(this.colors.info)('📝 Новая задача'),
            value: 'task'
          },
          {
            name: chalk.hex(this.colors.dim)('🚪 Выход'),
            value: 'exit'
          }
        ]
      }
    ]);

    return action;
  }

  /**
   * Показывает сообщение о загрузке
   */
  showLoading(message: string): void {
    this.startSpinner(message);
  }

  /**
   * Показывает прощальное сообщение
   */
  showGoodbye(): void {
    console.log('');
    console.log(
      boxen(
        gradient(['#6C5CE7', '#A29BFE'])('👋 До встречи!\n') +
        chalk.hex(this.colors.dim)('Bragent завершает работу...'),
        {
          padding: 1,
          margin: { top: 0, bottom: 1, left: 2, right: 2 },
          borderStyle: 'round',
          borderColor: '#6C5CE7',
          backgroundColor: '#1E272E'
        }
      )
    );
  }

  /**
   * Показывает подсказки для начала работы
   */
  showTips(): void {
    const tips = [
      '💡 Совет: Вы можете войти в аккаунты вручную — агент продолжит с того места',
      '💡 Совет: Будьте конкретны в описании задачи для лучших результатов',
      '💡 Совет: Агент попросит подтверждение перед опасными действиями (оплата, удаление)'
    ];

    const randomTip = tips[Math.floor(Math.random() * tips.length)];
    console.log(chalk.hex(this.colors.dim)(randomTip));
    console.log('');
  }
}
