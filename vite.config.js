// Настройки сборки.
// base: './' — чтобы игра работала на GitHub Pages из подпапки репозитория.
export default {
  base: './',
  server: { host: true },   // host: true — открыть игру с iPad по локальной сети
  build: { outDir: 'dist' },
};
