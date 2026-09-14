import { createWorkerPlugin } from '@buckle/plugin-sdk'

createWorkerPlugin({
  'com.buckle.examples.bulk-rename.open': async api => {
    await api.openPanel('com.buckle.examples.bulk-rename.panel')
  },
})
