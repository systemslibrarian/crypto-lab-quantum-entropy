import './style.css'
import { $ } from './ui/dom.ts'
import { initEntropyPanel } from './ui/entropyPanel.ts'
import { initHealthPanel } from './ui/healthPanel.ts'
import { initHealthWorkshop } from './ui/healthWorkshop.ts'
import { initSourcePanel } from './ui/sourcePanel.ts'
import { regenerate } from './ui/state.ts'
import { initToeplitzPanel } from './ui/toeplitzPanel.ts'
import { initVNPanel } from './ui/vnPanel.ts'

initSourcePanel($('#panel-source'))
initEntropyPanel($('#panel-entropy'))
initVNPanel($('#panel-vn'))
initToeplitzPanel($('#panel-toeplitz'))
initHealthPanel($('#panel-health'))
initHealthWorkshop($('#panel-health-workshop'))

// Initial stream so every panel shows the default 53/47 device on load.
regenerate()
