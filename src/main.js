import { startApp } from './app.js';

try {
  const response = await fetch(new URL('../data/word.json', import.meta.url));
  if (!response.ok) throw new Error('HTTP ' + response.status);
  startApp(await response.json());
} catch (error) {
  document.getElementById('statusMessage').textContent =
    'Не удалось загрузить рисунок. Запусти npm start или открой dist/index.html.';
  console.error(error);
}
