import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// index.css omitted — Strato components supply all styling via design tokens

// Initialize Dynatrace App
if ((window as any).dtAppConfig) {
  console.log('✅ Running as Dynatrace App');
} else {
  console.log('⚠️ Running in development mode (not in Dynatrace environment)');
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
