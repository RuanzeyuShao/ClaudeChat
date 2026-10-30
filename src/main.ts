import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
import './theme.css'
import { useUiStore } from './stores/ui'
import { motionManager,vMotion } from './motion/runtime'
import './motion/tokens.css'
import { themeManager } from './themes/themeManager'

const app=createApp(App)
themeManager.apply(themeManager.cached())
motionManager.start()
app.directive('motion',vMotion)
app.use(createPinia())
app.config.errorHandler=(error)=>useUiStore().failure(error)
app.mount('#app')

import './provider-selector.css'
import './api-settings.css'

import './motion/motion.css'

import './workbench.css'
