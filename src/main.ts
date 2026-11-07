import '@fontsource/funnel-display/700.css';
import '@fontsource-variable/montserrat';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
