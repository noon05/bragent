import { BrowserAction, SecurityCheck } from '../types/index.js';

/**
 * SecurityLayer - проверяет действия агента на опасность
 * и запрашивает подтверждение пользователя при необходимости
 */
export class SecurityLayer {
  // Паттерны для определения опасных действий
  private destructivePatterns = {
    // URL паттерны
    urlPatterns: [
      /checkout/i,
      /payment/i,
      /pay\//i,
      /order\/confirm/i,
      /purchase/i,
      /buy/i,
      /delete/i,
      /remove/i,
      /cancel/i,
      /unsubscribe/i,
      /terminate/i,
      /close.?account/i,
    ],
    // Текст кнопок
    buttonTextPatterns: [
      /оплатить/i,
      /купить/i,
      /заказать/i,
      /подтвердить.*заказ/i,
      /удалить/i,
      /отменить/i,
      /отписаться/i,
      /закрыть.*аккаунт/i,
      /pay/i,
      /buy/i,
      /purchase/i,
      /confirm.*order/i,
      /delete/i,
      /remove/i,
      /cancel/i,
      /unsubscribe/i,
      /terminate/i,
      /send.*money/i,
      /transfer/i,
      /отправить.*деньги/i,
      /перевести/i,
    ],
    // Типы форм
    formPatterns: [
      /credit.?card/i,
      /card.?number/i,
      /cvv/i,
      /expir/i,
      /password/i,
      /pin/i,
      /ssn/i,
      /passport/i,
      /кредитная.*карта/i,
      /номер.*карты/i,
      /пароль/i,
      /пин/i,
    ],
  };

  /**
   * Проверяет действие и определяет уровень риска
   */
  checkAction(action: BrowserAction, pageContext?: { url: string; elementText?: string }): SecurityCheck {
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let reason = '';
    let requiresConfirmation = false;

    // Проверяем навигацию на опасные URL
    if (action.type === 'navigate' && action.url) {
      const urlRisk = this.checkUrlRisk(action.url);
      if (urlRisk.isRisky) {
        riskLevel = urlRisk.level;
        reason = urlRisk.reason;
        requiresConfirmation = urlRisk.level === 'high' || urlRisk.level === 'critical';
      }
    }

    // Проверяем клики
    if (action.type === 'click') {
      const clickRisk = this.checkClickRisk(pageContext?.elementText || '', pageContext?.url || '');
      if (clickRisk.isRisky) {
        riskLevel = this.maxRisk(riskLevel, clickRisk.level);
        reason = clickRisk.reason;
        requiresConfirmation = clickRisk.level === 'high' || clickRisk.level === 'critical';
      }
    }

    // Проверяем ввод текста в чувствительные поля
    if (action.type === 'type_text' && action.selector) {
      const typeRisk = this.checkTypeRisk(action.selector, action.text || '');
      if (typeRisk.isRisky) {
        riskLevel = this.maxRisk(riskLevel, typeRisk.level);
        reason = typeRisk.reason;
        requiresConfirmation = typeRisk.level === 'high' || typeRisk.level === 'critical';
      }
    }

    // Проверяем текущий URL
    if (pageContext?.url) {
      const currentUrlRisk = this.checkUrlRisk(pageContext.url);
      if (currentUrlRisk.isRisky && currentUrlRisk.level === 'critical') {
        riskLevel = 'high';
        reason = `Вы находитесь на странице: ${currentUrlRisk.reason}`;
        requiresConfirmation = true;
      }
    }

    return {
      action,
      riskLevel,
      reason,
      requiresConfirmation
    };
  }

  private checkUrlRisk(url: string): { isRisky: boolean; level: 'low' | 'medium' | 'high' | 'critical'; reason: string } {
    for (const pattern of this.destructivePatterns.urlPatterns) {
      if (pattern.test(url)) {
        if (/payment|checkout|pay\//i.test(url)) {
          return { isRisky: true, level: 'critical', reason: `Страница оплаты: ${url}` };
        }
        if (/delete|remove|cancel|terminate/i.test(url)) {
          return { isRisky: true, level: 'high', reason: `Страница удаления/отмены: ${url}` };
        }
        return { isRisky: true, level: 'medium', reason: `Потенциально опасный URL: ${url}` };
      }
    }
    return { isRisky: false, level: 'low', reason: '' };
  }

  private checkClickRisk(buttonText: string, currentUrl: string): { isRisky: boolean; level: 'low' | 'medium' | 'high' | 'critical'; reason: string } {
    for (const pattern of this.destructivePatterns.buttonTextPatterns) {
      if (pattern.test(buttonText)) {
        if (/оплатить|pay|купить|buy|purchase/i.test(buttonText)) {
          return { isRisky: true, level: 'critical', reason: `Кнопка оплаты/покупки: "${buttonText}"` };
        }
        if (/удалить|delete|remove|отменить|cancel/i.test(buttonText)) {
          return { isRisky: true, level: 'high', reason: `Кнопка удаления/отмены: "${buttonText}"` };
        }
        if (/подтвердить|confirm|отправить|send/i.test(buttonText)) {
          return { isRisky: true, level: 'medium', reason: `Кнопка подтверждения: "${buttonText}"` };
        }
      }
    }
    return { isRisky: false, level: 'low', reason: '' };
  }

  private checkTypeRisk(selector: string, value: string): { isRisky: boolean; level: 'low' | 'medium' | 'high' | 'critical'; reason: string } {
    for (const pattern of this.destructivePatterns.formPatterns) {
      if (pattern.test(selector)) {
        if (/card|cvv|credit/i.test(selector)) {
          return { isRisky: true, level: 'critical', reason: `Ввод данных карты в поле: ${selector}` };
        }
        if (/password|пароль/i.test(selector)) {
          return { isRisky: true, level: 'high', reason: `Ввод пароля в поле: ${selector}` };
        }
        return { isRisky: true, level: 'medium', reason: `Чувствительные данные в поле: ${selector}` };
      }
    }
    return { isRisky: false, level: 'low', reason: '' };
  }

  private maxRisk(...levels: ('low' | 'medium' | 'high' | 'critical')[]): 'low' | 'medium' | 'high' | 'critical' {
    const order = ['low', 'medium', 'high', 'critical'];
    let maxIndex = 0;
    for (const level of levels) {
      const index = order.indexOf(level);
      if (index > maxIndex) maxIndex = index;
    }
    return order[maxIndex] as 'low' | 'medium' | 'high' | 'critical';
  }

  /**
   * Форматирует предупреждение для пользователя
   */
  formatWarning(check: SecurityCheck): string {
    const icons = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      critical: '🔴'
    };

    const levelNames = {
      low: 'Низкий',
      medium: 'Средний',
      high: 'Высокий',
      critical: 'Критический'
    };

    return `
${icons[check.riskLevel]} ПРЕДУПРЕЖДЕНИЕ БЕЗОПАСНОСТИ

Уровень риска: ${levelNames[check.riskLevel]}
Причина: ${check.reason}

Действие: ${check.action.type}
${check.action.selector ? `Элемент: ${check.action.selector}` : ''}
${check.action.url ? `URL: ${check.action.url}` : ''}
${check.action.value ? `Значение: ${check.action.value.slice(0, 50)}...` : ''}

Вы уверены, что хотите продолжить?
`;
  }
}
