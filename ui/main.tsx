import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppRoot } from '@dynatrace/strato-components/core';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <AppRoot>
      <App />
    </AppRoot>
  </React.StrictMode>
);
