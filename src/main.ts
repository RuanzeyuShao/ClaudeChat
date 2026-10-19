import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
import './theme.css'
import { useUiStore } from './stores/ui'
import { themeManager } from './themes/themeManager'

const app=createApp(App)
themeManager.apply(themeManager.cached())
app.use(createPinia())
app.config.errorHandler=(error)=>useUiStore().failure(error)
app.mount('#app')

import './provider-selector.css'
import './api-settings.css'
