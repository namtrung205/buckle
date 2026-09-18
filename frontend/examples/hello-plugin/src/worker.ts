import { createWorkerPlugin } from '@buckle/plugin-sdk'

const plugin = createWorkerPlugin({
  'com.buckle.examples.hello.run': async api => {
    await api.openPanel('com.buckle.examples.hello.panel')
  },
})

void plugin.api.query().then(async snapshot => {
  await plugin.api.notify(
    `Hello Buckle! ${snapshot.nodes.length} nodes, ${snapshot.members.length} members`,
    'success',
  )
}).catch(error => {
  void plugin.api.notify(`Hello Buckle error: ${String(error)}`, 'error')
})
