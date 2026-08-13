import { createApp } from './app';
import './styles/main.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app element not found');

createApp(root).init();
