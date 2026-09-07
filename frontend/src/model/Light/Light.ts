import * as THREE from 'three'

/**
 * Ambient fill + hemisphere "sky/ground" gradient.
 *
 * NOTE (lighting): the viewer used to light the solid model with only a flat
 * ambient (Camera.ts adds another 1.2 ambient; this class's old 0.1 did almost
 * nothing). There was NO directional light added to the scene (it exists in
 * Camera.ts but is commented out), so solids looked flat / underlit. We keep
 * this class as the ambient/hemisphere fill — a hemisphere adds directional
 * variation (bright from above, dimmer from below) so members read as volumes
 * instead of flat silhouettes.
 */
class Light {
  scene : THREE.Scene
  enabled : boolean
  // directionalLight : THREE.DirectionalLight
  ambientLight : THREE.AmbientLight
  hemisphereLight : THREE.HemisphereLight
  set setupEvent(enabled : boolean) {
    if (enabled) {
      // this.directionalLight.position.set(5, 50, 7.5);
      // this.scene.add(this.directionalLight)
      this.scene.add(this.ambientLight)
      this.scene.add(this.hemisphereLight)
    }
  }
  constructor(scene : THREE.Scene) {
    // this.directionalLight = new THREE.DirectionalLight(0xffffff, 10)
    // this.directionalLight.castShadow = true;
    // A stronger ambient base so the whole model never falls into darkness.
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    // Sky/ground hemisphere: bright white from above, soft grey-blue from
    // below — volumes read with depth but stay neutral on a dark background.
    this.hemisphereLight = new THREE.HemisphereLight(0xe8eef6, 0x55606e, 0.45)

    this.scene = scene
    this.enabled = true
    this.setupEvent = true
  } 
}

export default Light
