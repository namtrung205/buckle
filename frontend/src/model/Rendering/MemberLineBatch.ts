import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type Model from '../Model'

type LayerBatch = {
  edges: THREE.LineSegments
  centerlines: LineSegments2
}

/**
 * Combines non-pickable member outlines and centre lines by model layer.
 * Member solid meshes remain independent and therefore keep the existing
 * selection/editing behaviour while two draw calls per member collapse to
 * two draw calls per populated layer.
 */
export default class MemberLineBatch {
  private readonly model: Model
  private readonly batches = new Map<number, LayerBatch>()
  private rebuildHandle: number | null = null
  private edgesVisible = true
  private centerlinesVisible = true
  private readonly edgeMaterial = new THREE.LineBasicMaterial({ color: 0x2e3944 })
  private readonly centerlineMaterial = new LineMaterial({
    color: 0xa0a0a0,
    linewidth: 4,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
  })
  private readonly point = new THREE.Vector3()

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
    this.clearBatchObjects()
    const edgesByLayer = new Map<number, number[]>()
    const centersByLayer = new Map<number, number[]>()

    for (const member of this.model.members) {
      const layer = member.layer ?? 0
      const edgePositions = edgesByLayer.get(layer) ?? []
      const centerPositions = centersByLayer.get(layer) ?? []
      edgesByLayer.set(layer, edgePositions)
      centersByLayer.set(layer, centerPositions)

      member.group?.updateMatrixWorld(true)
      const attribute = member.edges?.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
      if (attribute) {
        for (let index = 0; index < attribute.count; index++) {
          this.point.fromBufferAttribute(attribute, index).applyMatrix4(member.group.matrixWorld)
          edgePositions.push(this.point.x, this.point.y, this.point.z)
        }
      }

      const [start, end] = member.nodes
      centerPositions.push(start.x, start.y, start.z, end.x, end.y, end.z)
    }

    const layers = new Set([...edgesByLayer.keys(), ...centersByLayer.keys()])
    for (const layer of layers) {
      const edgeGeometry = new THREE.BufferGeometry()
      edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgesByLayer.get(layer) ?? [], 3))
      const edgeLines = new THREE.LineSegments(edgeGeometry, this.edgeMaterial)
      edgeLines.userData.type = 'member-edge-batch'
      edgeLines.layers.set(layer)
      edgeLines.visible = this.edgesVisible

      const centerGeometry = new LineSegmentsGeometry()
      centerGeometry.setPositions(centersByLayer.get(layer) ?? [])
      const centerLines = new LineSegments2(centerGeometry, this.centerlineMaterial)
      centerLines.computeLineDistances()
      centerLines.userData.type = 'member-centerline-batch'
      centerLines.layers.set(layer)
      centerLines.visible = this.centerlinesVisible

      this.model.scene.add(edgeLines, centerLines)
      this.batches.set(layer, { edges: edgeLines, centerlines: centerLines })
    }
    this.updateResolution()
  }

  setEdgesVisible(visible: boolean) {
    this.edgesVisible = visible
    for (const batch of this.batches.values()) batch.edges.visible = visible
  }

  setCenterlinesVisible(visible: boolean) {
    this.centerlinesVisible = visible
    for (const batch of this.batches.values()) batch.centerlines.visible = visible
  }

  updateResolution() {
    const size = this.model.renderer.getSize(new THREE.Vector2())
    this.centerlineMaterial.resolution.set(size.x, size.y)
  }

  private clearBatchObjects() {
    for (const batch of this.batches.values()) {
      this.model.scene.remove(batch.edges, batch.centerlines)
      batch.edges.geometry.dispose()
      batch.centerlines.geometry.dispose()
    }
    this.batches.clear()
  }

  dispose() {
    if (this.rebuildHandle != null) cancelAnimationFrame(this.rebuildHandle)
    this.rebuildHandle = null
    this.clearBatchObjects()
    this.edgeMaterial.dispose()
    this.centerlineMaterial.dispose()
  }
}
