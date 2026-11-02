/** Mesma configuração que a página usava no CDN, agora para gerar o styles.css fixo. */
module.exports = {
  content: ['./index.html', './app.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        slate: { 850: '#131c2e', 900: '#0f172a', 950: '#020617' }
      }
    }
  },
  plugins: []
};
