import { createVaporApp } from 'vue';
import App from './App.vue';
import '@sentropic/design-system-vue/styles.css';
import '../src/style.css';
import './review/review.css';

const payload = JSON.parse(document.querySelector('[data-focus-document]').textContent);
createVaporApp(App, payload).mount('#app');
