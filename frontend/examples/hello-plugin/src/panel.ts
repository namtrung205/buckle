import { PluginPanelClient } from '@buckle/plugin-sdk'

const api = PluginPanelClient.forParentWindow()
const result = document.querySelector<HTMLDivElement>('#result')!

document.querySelector<HTMLButtonElement>('#read-model')!.addEventListener('click', async () => {
  result.textContent = 'Reading model...'
  try {
    const snapshot = await api.query()
    result.textContent = `Nodes: ${snapshot.nodes.length}\n` +
      `Members: ${snapshot.members.length}\n` +
      `Loads: ${snapshot.loads.length}`
  } catch (error) {
    result.textContent = `Query failed: ${String(error)}`
  }
})
