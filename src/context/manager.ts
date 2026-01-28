import { PageContext, PageElement, FormInfo, LinkInfo } from '../types/index.js';

/**
 * ContextManager - управляет сжатием и форматированием контекста страницы
 * для эффективного использования токенов AI
 */
export class ContextManager {
  private maxTokens: number;
  private contextHistory: PageContext[] = [];
  private maxHistorySize: number = 5;

  constructor(maxTokens: number = 4000) {
    this.maxTokens = maxTokens;
  }

  /**
   * Форматирует контекст страницы для отправки в AI
   */
  formatContextForAI(context: PageContext): string {
    const parts: string[] = [];

    // Заголовок страницы
    parts.push(`URL: ${context.url}`);
    parts.push(`Заголовок: ${context.title}`);

    // Информация о модальном окне
    if (context.hasModal) {
      parts.push(`\n⚠️ МОДАЛЬНОЕ ОКНО ОТКРЫТО! ${context.modalHint || 'Используй элементы внутри него.'}`);  
    }

    // Интерактивные элементы (только первые 20 - ключевые)
    if (context.elements.length > 0) {
      const elementsToShow = context.elements.slice(0, 20);
      parts.push(`\nЭлементы (${elementsToShow.length})${context.hasModal ? ' [в модалке]' : ''}:`);
      parts.push(this.formatElements(elementsToShow));
    }

    // Формы (только первые 2)
    if (context.forms.length > 0) {
      parts.push(`\nФормы:`);
      parts.push(this.formatForms(context.forms.slice(0, 2)));
    }

    const result = parts.join('\n');
    
    // Сохраняем в историю
    this.addToHistory(context);
    
    return this.truncateToTokenLimit(result);
  }

  private formatElements(elements: PageElement[]): string {
    return elements.map(el => {
      const attrs = el.attributes ? Object.entries(el.attributes)
        .filter(([k, v]) => v && v.length < 50)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ') : '';
      
      const attrStr = attrs ? ` (${attrs})` : '';
      const index = el.index ?? 0;
      return `[${index}] <${el.tag}> "${el.text}"${attrStr} → selector: ${el.selector}`;
    }).join('\n');
  }

  private formatForms(forms: FormInfo[]): string {
    return forms.map(form => {
      const fields = Array.isArray(form.fields) ? form.fields.map(f => 
        `  - ${f.name || 'unnamed'} (${f.type || 'text'})${f.required ? ' *обязательное*' : ''} → ${f.selector || ''}`
      ).join('\n') : '  (нет полей)';
      return `Форма ${form.index ?? 0} [${(form.method || 'GET').toUpperCase()}]:\n${fields}`;
    }).join('\n\n');
  }

  private formatLinks(links: LinkInfo[]): string {
    return links.map(link => 
      `[${link.index}] "${link.text}" → ${link.href}`
    ).join('\n');
  }

  private compressTextContent(text: string): string {
    // Удаляем лишние пробелы и переносы
    let compressed = text.replace(/\s+/g, ' ').trim();
    
    // Ограничиваем длину
    if (compressed.length > 2000) {
      compressed = compressed.slice(0, 2000) + '... [контент обрезан]';
    }
    
    return compressed;
  }

  private truncateToTokenLimit(text: string): string {
    // Грубая оценка: 1 токен ≈ 4 символа для английского, 2-3 для русского
    const estimatedTokens = text.length / 3;
    
    if (estimatedTokens > this.maxTokens) {
      const maxChars = this.maxTokens * 3;
      return text.slice(0, maxChars) + '\n\n[Контекст обрезан из-за ограничения токенов]';
    }
    
    return text;
  }

  private addToHistory(context: PageContext): void {
    this.contextHistory.push(context);
    if (this.contextHistory.length > this.maxHistorySize) {
      this.contextHistory.shift();
    }
  }

  /**
   * Получает сжатую историю навигации
   */
  getNavigationHistory(): string {
    if (this.contextHistory.length === 0) return 'Нет истории навигации';
    
    return this.contextHistory.map((ctx, i) => 
      `${i + 1}. ${ctx.title} (${ctx.url})`
    ).join('\n');
  }

  /**
   * Очищает историю
   */
  clearHistory(): void {
    this.contextHistory = [];
  }

  /**
   * Создаёт краткую сводку страницы для memory
   */
  createPageSummary(context: PageContext): string {
    return `Страница: ${context.title}
URL: ${context.url}
Элементов: ${context.elements.length}
Форм: ${context.forms.length}
Ссылок: ${context.links.length}`;
  }
}
