import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as THREE from 'three'
import GpuAnnotations, { glyphAdvance, glyphUvRect, scheduleProjectedLabels, type ProjectedLabel } from './GpuAnnotations.ts'
import { StructuralSceneDB } from './StructuralSceneDB.ts'

const label = (id: string, priority: ProjectedLabel['priority'], x: number): ProjectedLabel => ({
  id, priority, text: id, anchor: [0, 0, 0], screenX: x, screenY: 10, depth: 0,
})

describe('GPU annotation scheduling', () => {
  it('keeps selected labels regardless of budget and collision', () => {
    const output = scheduleProjectedLabels([label('id', 'id', 1), label('selected', 'selected', 2)], 0)
    assert.deepEqual(output.map(item => item.id), ['selected'])
  })

  it('applies priority, declutter and the regular-label budget', () => {
    const output = scheduleProjectedLabels([
      label('value', 'value', 1), label('id', 'id', 2), label('extrema', 'extrema', 200), label('id-2', 'id', 400),
    ], 2)
    assert.deepEqual(output.map(item => item.id), ['extrema', 'id', 'id-2'])
  })

  it('maps printable glyphs to stable atlas cells', () => {
    assert.deepEqual(glyphUvRect('A'), glyphUvRect('A'))
    assert.notDeepEqual(glyphUvRect('A'), glyphUvRect('B'))
  })

  it('uses compact per-character CAD text spacing', () => {
    assert.ok(glyphAdvance('I') < glyphAdvance('H'))
    assert.ok(glyphAdvance(' ') < glyphAdvance('0'))
    assert.ok(glyphAdvance('W') > glyphAdvance('0'))
  })

  it('uploads member labels and support symbols into the two shared batches', () => {
    const database = new StructuralSceneDB({
      nodes: [{ id: 1, position: [-1, 0, 0] }, { id: 2, position: [1, 0, 0] }],
      profiles: [{ id: 1, family: 'h', parameters: [.3, .2, .01, .02] }],
      members: [{ id: 10, startNodeId: 1, endNodeId: 2, profileId: 1 }],
    })
    const scene = new THREE.Scene()
    const annotations = new GpuAnnotations(scene)
    ;(annotations.textMesh.geometry as any)._maxInstanceCount = 0
    ;(annotations.symbolMesh.geometry as any)._maxInstanceCount = 0
    annotations.setMemberLabels(true)
    annotations.setEntityLabels(new Map([[10, 'Beam H300']]), new Map())
    annotations.setData([{ anchor: [-1, 0, 0], kind: 0, state: 0b001101, color: [0.2, 0.9, 0.35] }])
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 100)
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); camera.updateProjectionMatrix()
    annotations.update(database, camera, 800, 600)
    const stats = annotations.getStats()
    assert.equal(stats.symbolInstances, 1)
    assert.equal(stats.glyphInstances, 'Beam H300'.length)
    assert.equal(stats.drawObjects, 2)
    assert.equal('_maxInstanceCount' in annotations.textMesh.geometry, false)
    assert.equal('_maxInstanceCount' in annotations.symbolMesh.geometry, false)
    assert.equal((annotations.symbolMesh.geometry.getAttribute('iState') as THREE.InstancedBufferAttribute).getX(0), 0b001101)

    annotations.setData([{ anchor: [0, 0, 0], direction: [1, -2, 3], kind: 1, color: [1, 0, 0] }])
    annotations.update(database, camera, 800, 600)
    const direction = annotations.symbolMesh.geometry.getAttribute('iDirection') as THREE.InstancedBufferAttribute
    assert.deepEqual(Array.from(direction.array.slice(0, 3)), [1, -2, 3])

    annotations.setMemberLabels(false)
    annotations.setLabelBudget(0)
    annotations.setResultLabels([
      { id: 'min', text: 'MIN M3 -20', anchor: [-.5, 0, 0], priority: 'extrema' },
      { id: 'max', text: 'MAX M3 40', anchor: [.5, 0, 0], priority: 'extrema' },
    ])
    annotations.update(database, camera, 800, 600)
    assert.equal(annotations.getStats().glyphInstances, 'MIN M3 -20MAX M3 40'.length)
    annotations.dispose()
  })
})
