import { mount } from 'svelte';
import App from './App.svelte';
import './style.css';

const payload = JSON.parse(document.querySelector('[data-focus-document]').textContent);
mount(App, { target: document.getElementById('app'), props: payload });
