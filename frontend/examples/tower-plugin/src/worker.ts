import { createWorkerPlugin } from '@buckle/plugin-sdk'

createWorkerPlugin({
  'com.buckle.examples.tower.open': async api => {
    await api.openPanel('com.buckle.examples.tower.panel')
  },
})