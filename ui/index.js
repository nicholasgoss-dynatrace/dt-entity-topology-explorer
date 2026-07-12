import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Initialize Dynatrace App
if (window.dtAppConfig) {
  console.log('✅ Running as Dynatrace App');
} else {
  console.log('⚠️ Running in development mode (not in Dynatrace environment)');
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
