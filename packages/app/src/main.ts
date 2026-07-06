import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { app } from './lib/toybox.svelte.ts'

void app.boot()

mount(App, { target: document.getElementById('app')! })
