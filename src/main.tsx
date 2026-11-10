import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import './styles.css';

import { render } from 'preact';
import { App } from './app';
import { applyTheme } from './lib/device';
import { initFeedback } from './lib/feedback';
import { loadStore } from './lib/store';
import { initSync } from './lib/sync';
import { initPwa } from './pwa';
import { initUi } from './ui';

applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
initUi();
render(<App />, document.getElementById('root')!);

void loadStore().then(() => {
  initSync();
  initPwa();
  initFeedback();
});
