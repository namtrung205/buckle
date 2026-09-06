import * as THREE from 'three'
import type Model from '../Model'

type InstanceRef = { batch: THREE.BatchedMesh; instanceId: number }
type BatchedMeshWithInstances = THREE.BatchedMesh & {
  addInstance: (geometryId: number) => number
}

/** Draws all member solids in one multi-draw batch per layer. */
export default class MemberSolidBatch {
  private readonly model: Model
  private readonly batches: THREE.BatchedMesh[] = []
  private readonly instancesByMemberId = new Map<number, InstanceRef>()
  private readonly memberIdsByBatch = new Map<THREE.BatchedMesh, Map<number, number>>()
  private rebuildHandle: number | null = null
  private visible = true
  private batchedRenderingEnabled = true

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
    const membersByLayer = new Map<number, typeof this.model.members>()
    for (const member of this.model.members) {
      const entries = membersByLayer.get(member.layer ?? 0) ?? []
      entries.push(member)
      membersByLayer.set(member.layer ?? 0, entries)
    }

    for (const [layer, members] of membersByLayer) {
      let vertexCount = 0
      let indexCount = 0
      for (const member of members) {
        vertexCount += member.mesh.geometry.getAttribute('position')?.count ?? 0
        indexCount += member.mesh.geometry.index?.count ?? 0
      }
      if (!vertexCount || !indexCount) continue

      const material = new THREE.MeshLambertMaterial({
        color: 0xa0a0a0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      })
      // three r173 exposes addInstance at runtime; the bundled @types package lags this API.
      const batch = new THREE.BatchedMesh(
        members.length,
        vertexCount,
        indexCount,
        material,
      ) as BatchedMeshWithInstances
      batch.userData.type = 'member-solid-batch'
      batch.layers.set(layer)
      batch.visible = this.visible && this.batchedRenderingEnabled
      const memberIdsByInstance = new Map<number, number>()

      for (const member of members) {
        member.group.updateMatrixWorld(true)
        const geometryId = batch.addGeometry(member.mesh.geometry)
        const instanceId = batch.addInstance(geometryId)
        batch.setMatrixAt(instanceId, member.group.matrixWorld)
        const sourceMaterial = member.mesh.material as THREE.MeshLambertMaterial
        batch.setColorAt(instanceId, sourceMaterial.color)
        member.mesh.userData.pickProxyActive = this.visible
        sourceMaterial.visible = true
        member.mesh.visible = !this.batchedRenderingEnabled && this.visible
        this.instancesByMemberId.set(member.id, { batch, instanceId })
        memberIdsByInstance.set(instanceId, member.id)
      }

      this.model.scene.add(batch)
      this.batches.push(batch)
      this.memberIdsByBatch.set(batch, memberIdsByInstance)
    }
  }

  setEntityColor(memberId: number, color: number) {
    const ref = this.instancesByMemberId.get(memberId)
    if (ref) ref.batch.setColorAt(ref.instanceId, new THREE.Color(color))
  }

  /** Resolve Three.js BatchedMesh intersection.batchId back to the domain entity. */
  getEntityId(batch: THREE.BatchedMesh, batchId: number): number | null {
    return this.memberIdsByBatch.get(batch)?.get(batchId) ?? null
  }

  get diagnostics() {
    let instances = 0
    for (const ids of this.memberIdsByBatch.values()) instances += ids.size
    return {
      batches: this.batches.length,
      instances,
      mappedEntities: this.instancesByMemberId.size,
      activePickProxies: this.model.members.filter(member => member.mesh.userData.pickProxyActive === true).length,
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible
    for (const member of this.model.members) {
      member.mesh.userData.pickProxyActive = visible
      member.mesh.visible = visible && !this.batchedRenderingEnabled
    }
    for (const batch of this.batches) batch.visible = visible && this.batchedRenderingEnabled
  }

  /** Stress gradients still use per-vertex colors on the original member mesh. */
  setBatchedRenderingEnabled(enabled: boolean) {
    this.batchedRenderingEnabled = enabled
    for (const member of this.model.members) {
      const material = member.mesh.material as THREE.Material
      material.visible = true
      member.mesh.userData.pickProxyActive = this.visible
      member.mesh.visible = !enabled && this.visible
    }
    for (const batch of this.batches) batch.visible = enabled && this.visible
  }

  private clearBatches() {
    for (const batch of this.batches) {
      this.model.scene.remove(batch)
      batch.dispose()
      batch.material.dispose()
    }
    this.batches.length = 0
    this.instancesByMemberId.clear()
    this.memberIdsByBatch.clear()
  }

  dispose() {
    if (this.rebuildHandle != null) cancelAnimationFrame(this.rebuildHandle)
    this.rebuildHandle = null
    this.clearBatches()
  }
}
