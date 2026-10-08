import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
import './theme.css'

createApp(App).use(createPinia()).mount('#app')

import './provider-selector.css'
import './api-settings.css'
