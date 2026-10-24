import { createRoot } from 'react-dom/client';
import { BulkSelection } from './activity-screen.stories';

// This selection-only fixture cannot call an API or mutate a mailbox.
globalThis.fetch = async () => {
  throw new Error('Network requests are disabled in this isolated fixture.');
};

createRoot(document.getElementById('root')!).render(BulkSelection.render!(undefined));
