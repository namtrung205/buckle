import * as THREE from 'three'
import type Model from '../Model'

type NodeInstanceRef = {
  batch: THREE.InstancedMesh
  instanceId: number
}

type NodeLayerBatch = {
  mesh: THREE.InstancedMesh
  nodes: Model['nodes']
}

/**
 * Renders node markers as one InstancedMesh per layer.
 *
 * The original node meshes remain in the scene as invisible-material proxies,
 * preserving the existing raycast, SelectionBox, snapping and editing paths.
 */
export default class NodeBatch {
  private readonly model: Model
  private readonly batches: NodeLayerBatch[] = []
  private readonly instancesByNodeId = new Map<number, NodeInstanceRef>()
  private rebuildHandle: number | null = null
  private visible = true

  constructor(model: Model) {
    this.model = model
  }

  scheduleRebuild() {
    if (this.rebuildHandle != null) return
    this.rebuildHandle = requestAnimationFrame(() => {
      this.rebuildHandle = null
      this.rebuild()
    })
  }

  rebuild() {
    this.clearBatches()

    const nodesByLayerMask = new Map<number, Model['nodes']>()
    for (const node of this.model.nodes) {
      const layerMask = node.mesh.layers.mask
      const nodes = nodesByLayerMask.get(layerMask) ?? []
      nodes.push(node)
      nodesByLayerMask.set(layerMask, nodes)
    }

    for (const [layerMask, nodes] of nodesByLayerMask) {
      if (!nodes.length) continue
      const geometry = nodes[0].mesh.geometry
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff })
      const batch = new THREE.InstancedMesh(geometry, material, nodes.length)
      batch.userData.type = 'node-batch'
      batch.layers.mask = layerMask
      batch.visible = this.visible
      // Node positions/scales can change while editing and while zooming. Avoid
      // stale instance bounds; the source proxies still provide precise picking.
      batch.frustumCulled = false

      nodes.forEach((node, instanceId) => {
        const sourceMaterial = node.mesh.material as THREE.MeshStandardMaterial
        node.mesh.userData.pickProxyActive = this.visible
        node.mesh.visible = false
        batch.setColorAt(instanceId, sourceMaterial.color)
        this.instancesByNodeId.set(node.id, { batch, instanceId })
      })

      this.model.scene.add(batch)
      this.batches.push({ mesh: batch, nodes })
    }

    this.syncMatrices()
  }

  /** Keep instance transforms aligned with constant-screen-size source proxies. */
  syncMatrices() {
    for (const { mesh: batch, nodes } of this.batches) {
      for (let instanceId = 0; instanceId < nodes.length; instanceId++) {
        const source = nodes[instanceId].mesh
        source.updateMatrixWorld(true)
        batch.setMatrixAt(instanceId, source.matrixWorld)
      }
      batch.instanceMatrix.needsUpdate = true
    }
  }

  setEntityColor(nodeId: number, color: number) {
    const ref = this.instancesByNodeId.get(nodeId)
    if (!ref) return
    ref.batch.setColorAt(ref.instanceId, new THREE.Color(color))
    if (ref.batch.instanceColor) ref.batch.instanceColor.needsUpdate = true
  }

  /** Mapping kept for a future direct instanced-raycast path. */
  getEntityId(batch: THREE.InstancedMesh, instanceId: number): number | null {
    const entry = this.batches.find(item => item.mesh === batch)
    return entry?.nodes[instanceId]?.id ?? null
  }

  get diagnostics() {
    return {
      batches: this.batches.length,
      instances: this.batches.reduce((sum, entry) => sum + entry.nodes.length, 0),
      mappedEntities: this.instancesByNodeId.size,
      activePickProxies: this.model.nodes.filter(node => node.mesh.userData.pickProxyActive === true).length,
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible
    for (const node of this.model.nodes) {
      node.mesh.userData.pickProxyActive = visible
      node.mesh.visible = false
    }
    for (const { mesh } of this.batches) mesh.visible = visible
  }

  private clearBatches() {
    for (const { mesh } of this.batches) {
      this.model.scene.remove(mesh)
      // Geometry belongs to the shared node marker; only this material is owned.
      if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose())
      else mesh.material.dispose()
    }
    this.batches.length = 0
    this.instancesByNodeId.clear()
  }

  dispose() {
    if (this.rebuildHandle != null) cancelAnimationFrame(this.rebuildHandle)
    this.rebuildHandle = null
    this.clearBatches()
  }
}
