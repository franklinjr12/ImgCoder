import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { boot, studio } from './state/studio';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
void boot();

// Expose the store for debugging and e2e tests.
(window as any).__artisanStudio = studio;
