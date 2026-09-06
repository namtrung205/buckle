import * as THREE from 'three'
import type Model from '../Model'

type BatchedMeshWithInstances = THREE.BatchedMesh & {
  addInstance: (geometryId: number) => number
}

/** Draws all shell faces in a single BatchedMesh while retaining source meshes for lifecycle data. */
export default class ShellBatch {
  private readonly model: Model
  private batch: THREE.BatchedMesh | null = null
  private rebuildHandle: number | null = null

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
    this.clearBatch()
    const shells = this.model.shells
    if (!shells.length) return
    let vertexCount = 0
    let indexCount = 0
    for (const shell of shells) {
      vertexCount += shell.mesh.geometry.getAttribute('position')?.count ?? 0
      indexCount += shell.mesh.geometry.index?.count ?? 0
    }
    if (!vertexCount || !indexCount) return

    const material = new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.15,
      metalness: 0.1,
      roughness: 0.5,
    })
    // three r173 exposes addInstance at runtime; the bundled @types package lags this API.
    const batch = new THREE.BatchedMesh(
      shells.length,
      vertexCount,
      indexCount,
      material,
    ) as BatchedMeshWithInstances
    batch.userData.type = 'shell-batch'
    for (const shell of shells) {
      const geometryId = batch.addGeometry(shell.mesh.geometry)
      const instanceId = batch.addInstance(geometryId)
      shell.mesh.updateMatrixWorld(true)
      batch.setMatrixAt(instanceId, shell.mesh.matrixWorld)
      ;(shell.mesh.material as THREE.Material).visible = false
    }
    this.model.scene.add(batch)
    this.batch = batch
  }

  get diagnostics() {
    return {
      batches: this.batch ? 1 : 0,
      instances: this.batch ? this.model.shells.length : 0,
    }
  }

  private clearBatch() {
    if (!this.batch) return
    this.model.scene.remove(this.batch)
    this.batch.dispose()
    this.batch.material.dispose()
    this.batch = null
  }

  dispose() {
    if (this.rebuildHandle != null) cancelAnimationFrame(this.rebuildHandle)
    this.rebuildHandle = null
    this.clearBatch()
  }
}
