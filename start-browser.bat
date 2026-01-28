@echo off
echo ========================================
echo   Запуск Яндекс Браузера для Bragent
echo ========================================
echo.

set BROWSER_PATH=C:\Users\Noon\AppData\Local\Yandex\YandexBrowser\Application\browser.exe

if exist "%BROWSER_PATH%" (
    echo Запускаю Яндекс Браузер с портом отладки 9222...
    start "" "%BROWSER_PATH%" --remote-debugging-port=9222
    echo.
    echo Браузер запущен! Теперь запустите агента:
    echo   npm run dev
    echo.
) else (
    echo Ошибка: Яндекс Браузер не найден!
    echo Путь: %BROWSER_PATH%
)

pause
