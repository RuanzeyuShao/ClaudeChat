import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
import './theme.css'
import { useUiStore } from './stores/ui'

const app=createApp(App)
app.use(createPinia())
app.config.errorHandler=(error)=>useUiStore().failure(error)
app.mount('#app')

import './provider-selector.css'
import './api-settings.css'
