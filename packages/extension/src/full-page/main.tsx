import React from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from '../popup/popup';
import '../popup/styles/popup.css';

document.documentElement.classList.add('full-page-document');
document.body.classList.add('full-page-body');

const root = createRoot(document.getElementById('root')!);
root.render(<Popup fullPage />);
