import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Model } from "../Model";
import { Vector3 } from "three";

/**
 * Per-DOF restraint state of a rigid support. Drives the sector colors of the
 * Midas-Civil style hexagon support symbol ('support' label type).
 */
export type SupportFixity = {
  x : boolean
  y : boolean
  z : boolean
  mx : boolean
  my : boolean
  mz : boolean
}

export type Label = {
  id : string
  position : Vector3
  text : string
  type? : string // 'effort' | 'load' | 'length' | 'angle' | 'arc' | 'gridSnap' | 'endPointSnap' | 'prompt' | 'support' | 'fixed-support' | 'pinned-support' | 'custom'
  rotation? : number
  backgroundColor? : string 
  fixity? : SupportFixity // 'support' labels: restraint flags rendered as hexagon sector colors
}

// ---------------------------------------------------------------------------
// Support symbol (Midas-Civil style)
// Regular hexagon split into 6 triangular sectors. Clockwise from the top
// vertex the DOF order is: X, Y, Z (right half) then MX, MY, MZ (left half).
// A sector is filled green when its DOF is restrained and red when it is free.
// Rendered through CSS2D so the symbol always draws on top of the 3D scene and
// keeps a constant screen size at any zoom / orbit angle.
// ---------------------------------------------------------------------------
const SUPPORT_FIX_COLOR = '#22c55e'      // restrained DOF (xanh)
const SUPPORT_FREE_COLOR = '#ef4444'     // free DOF (đỏ)
const SUPPORT_OUTLINE_COLOR = '#111827'  // sector borders
const SUPPORT_HEX_RADIUS = 10            // hexagon circumradius in px

function buildSupportHexagon(fixity : SupportFixity) : SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const r = SUPPORT_HEX_RADIUS
  const size = r * 2 + 2
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`)
  svg.style.display = 'block'
  svg.style.overflow = 'visible'

  // Pointy-top hexagon: vertices clockwise starting at the top vertex (90°)
  const vertexAngles = [90, 30, -30, -90, -150, 150]
  const vertices = vertexAngles.map(deg => {
    const rad = deg * Math.PI / 180
    // Screen Y grows downward → flip the sign so 90° points up
    return { x: Math.cos(rad) * r, y: -Math.sin(rad) * r }
  })

  // Sector i = triangle (center, vertex[i], vertex[i+1]); clockwise from top
  const dofOrder : (keyof SupportFixity)[] = ['x', 'y', 'z', 'mx', 'my', 'mz']
  for(let i = 0; i < 6; i++){
    const v1 = vertices[i]
    const v2 = vertices[(i + 1) % 6]
    const sector = document.createElementNS(ns, 'polygon')
    sector.setAttribute('points', `0,0 ${v1.x},${v1.y} ${v2.x},${v2.y}`)
    sector.setAttribute('fill', fixity[dofOrder[i]] ? SUPPORT_FIX_COLOR : SUPPORT_FREE_COLOR)
    sector.setAttribute('stroke', SUPPORT_OUTLINE_COLOR)
    sector.setAttribute('stroke-width', '0.5')
    sector.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(sector)
  }
  return svg
}

class Labeler {
  model : Model
  renderer : CSS2DRenderer
  enabled = true
  private labelObjects: CSS2DObject[] = [];

  set setupEvent(enabled: boolean) {
    // if (enabled) {
    //  window.addEventListener('click', this.addLabelOnClick)
    // } else {
    //   window.removeEventListener('click', this.addLabelOnClick)
    // }
  }
  constructor(model : Model) {  
    this.model = model
    this.renderer = new CSS2DRenderer();
    const vpW: number = this.model.canvas.clientWidth
    const vpH: number = this.model.canvas.clientHeight
    this.renderer.setSize(vpW, vpH);
    this.renderer.domElement.id ='label-container'
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0px';
    this.renderer.domElement.style.width = '100vw';
    this.renderer.domElement.style.height = '100vh';
    this.renderer.domElement.style.overflow = 'hidden';
    this.renderer.domElement.style.pointerEvents = 'none';
    document.getElementById('app-container')?.appendChild(this.renderer.domElement);
    this.setupEvent = true
  }
  
  create(labels : Label[]) {

    for(const label of labels){
      const wrapper = document.createElement('div');
      const type = label.type
      const position = label.position;
      const p = document.createElement('p');
      p.className = 'label';
      p.textContent = label.text;
      const modernFont = '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif';
      
      p.style.color = '#e0e0e0'; // Light text so labels read on the dark viewport
      p.style.fontWeight = 'bold';
      p.style.textAlign = 'center';
      p.style.margin = '0';
      p.style.padding = '0';
      p.style.fontFamily = modernFont;
      const pContainer = document.createElement('div');
      pContainer.style.fontSize = '12px';
      pContainer.style.fontFamily = modernFont;
      pContainer.id = label.id
      wrapper.appendChild(pContainer)

      if (type === 'effort') {
        // Effort styling — compact solid pill: no border, accent background, white mono value
        const accent = label.backgroundColor || '#2f6fed';
        pContainer.style.backgroundColor = accent;
        pContainer.style.border = 'none';
        pContainer.style.borderRadius = '999px';
        pContainer.style.padding = '1px 7px';
        pContainer.style.height = 'auto';
        pContainer.style.width = 'auto';
        pContainer.style.minWidth = '0';
        pContainer.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
        p.style.color = '#ffffff';
        p.style.fontFamily = '"JetBrains Mono", ui-monospace, "SF Mono", monospace';
        p.style.fontSize = '10.5px';
        p.style.fontWeight = '700';
        p.style.lineHeight = '1.5';
        p.style.whiteSpace = 'nowrap';
      }
      else if (type === 'reaction') {
        // SHX-style stroked value text: thin font, no background, pink - like
        // the CAD "text" layer of Midas/Civil where value tags are readable
        // over the model without any box.
        pContainer.style.backgroundColor = 'transparent';
        pContainer.style.border = 'none';
        pContainer.style.padding = '0';
        pContainer.style.boxShadow = 'none';
        pContainer.style.height = 'auto';
        pContainer.style.width = 'auto';
        p.style.color = '#f472b6';
        p.style.fontFamily = '"Consolas", "Roboto Mono", ui-monospace, monospace';
        p.style.fontSize = '11px';
        p.style.fontWeight = '300';
        p.style.lineHeight = '1.2';
        p.style.letterSpacing = '0.4px';
        p.style.whiteSpace = 'nowrap';
        p.style.textShadow = 'none';
      }
      else if (type === 'length') {
        pContainer.style.backgroundColor = 'white';
        pContainer.style.height = '30px';
        pContainer.style.width = '50px';
        pContainer.style.border = '1px solid black';
        pContainer.style.color = 'black';
        p.style.color = 'black'; // Dark text on the white pill
      }
      else if (type === 'gridSnap') {
        pContainer.style.backgroundColor = 'transparent';
        pContainer.style.height = '20px';
        pContainer.style.width = '20px';
        pContainer.style.boxShadow = 'none';  // Remove the shadow
        pContainer.style.border = 'none';     // Remove any border
        pContainer.style.padding = '0';       // Remove padding
        pContainer.style.background = 'none'; // Ensure no background
        pContainer.style.color = 'black';
        pContainer.style.fontSize = '18px';
        p.style.color = '#FF0000'; // Red X
        p.style.fontSize = '16px';
        p.style.fontWeight = 'bold';
        pContainer.style.border = '2px solid #FF0000';
        pContainer.style.borderRadius = '0%';
        pContainer.style.position = 'relative';
      }
      else if(type === 'endPointSnap'){
        pContainer.style.backgroundColor = 'transparent';
        pContainer.style.height = '20px';
        pContainer.style.width = '20px';
        pContainer.style.boxShadow = 'none';  // Remove the shadow
        pContainer.style.border = 'none';     // Remove any border
        pContainer.style.padding = '0';       // Remove padding
        pContainer.style.background = 'none'; // Ensure no background
        pContainer.style.color = 'black';
        pContainer.style.fontSize = '18px';
        p.style.color = '#FF0000'; // Red X
        p.style.fontSize = '16px';
        p.style.fontWeight = 'bold';
        pContainer.style.border = '2px solid #FF0000';
        pContainer.style.borderRadius = '50%';
        pContainer.style.position = 'relative';
      }
      else if(type === 'prompt'){
        pContainer.style.backgroundColor = '#FFFFD4'; // Light yellow background
        pContainer.style.minWidth = '150px';
        pContainer.style.padding = '4px 8px';
        pContainer.style.borderRadius = '0px'; // Remove rounded corners
        pContainer.style.border = '1px solid #A0A0A0'; // Light gray border
        p.style.color = '#000000'; // Black text
        p.style.fontSize = '12px';
        p.style.fontFamily = modernFont;
        pContainer.style.boxShadow = '2px 2px 2px rgba(0,0,0,0.1)'; // Subtle shadow
        // Position the prompt label with an offset from the cursor
        pContainer.style.transform = 'translate(60%, 0)';
        // Align the container to the left corner instead of center
        pContainer.style.justifyContent = 'flex-start';
        wrapper.style.transformOrigin = 'left top';
      }
      else if(type === 'fixed-support'){
        // Fixed support styling - red rectangle with small arrow
        pContainer.style.backgroundColor = '#d32f2f'; // Red fill
        pContainer.style.height = '25px';
        pContainer.style.width = '60px';
        pContainer.style.borderRadius = '3px';
        pContainer.style.position = 'relative';
        p.style.color = 'white';
        p.style.fontSize = '10px';
        p.style.fontWeight = 'bold';
        
        // Create small arrow indicator for fixed support
        const arrow = document.createElement('div');
        arrow.style.width = '0';
        arrow.style.height = '0';
        arrow.style.borderLeft = '6px solid transparent';
        arrow.style.borderRight = '6px solid transparent';
        arrow.style.borderTop = '8px solid #d32f2f'; // Same color as container
        arrow.style.position = 'absolute';
        arrow.style.bottom = '-8px';
        arrow.style.left = '24px'; // Center the arrow
        pContainer.appendChild(arrow);
      }
      else if(type === 'pinned-support'){
        // Pinned support styling - light blue rectangle with small arrow
        pContainer.style.backgroundColor = '#64b5f6'; // Light blue fill
        pContainer.style.height = '25px';
        pContainer.style.width = '60px';
        pContainer.style.borderRadius = '3px';
        pContainer.style.position = 'relative';
        p.style.color = 'white';
        p.style.fontSize = '10px';
        p.style.fontWeight = 'bold';
        
        // Create small arrow indicator for pinned support
        const arrow = document.createElement('div');
        arrow.style.width = '0';
        arrow.style.height = '0';
        arrow.style.borderLeft = '6px solid transparent';
        arrow.style.borderRight = '6px solid transparent';
        arrow.style.borderTop = '8px solid #64b5f6'; // Same color as container
        arrow.style.position = 'absolute';
        arrow.style.bottom = '-8px';
        arrow.style.left = '24px'; // Center the arrow
        pContainer.appendChild(arrow);
      }
      else if(type === 'support'){
        // Midas-Civil style hexagon support symbol — pure CSS2D annotation,
        // always rendered on top of the 3D scene at constant screen size.
        pContainer.style.backgroundColor = 'transparent';
        pContainer.style.height = 'auto';
        pContainer.style.width = 'auto';
        pContainer.style.minWidth = '0';
        pContainer.style.boxShadow = 'none';
        pContainer.style.border = 'none';
        pContainer.style.padding = '0';
        pContainer.style.position = 'relative';
        p.style.display = 'none';
        if(label.fixity){
          pContainer.appendChild(buildSupportHexagon(label.fixity));
        }
      }
      
      else {
        pContainer.style.backgroundColor = 'transparent';
        pContainer.style.height = '20px';
        pContainer.style.width = '100px';
        pContainer.style.position = 'relative';
        pContainer.style.color = '#e0e0e0';
      }
      
      // if (type !== 'gridSnap') {
      //   pContainer.style.color = 'black';
      //   pContainer.style.padding = '5px';
      //   pContainer.style.boxShadow = '0 0 10px 0 rgba(0, 0, 0, 0.5)';
      // }
      pContainer.className = 'label-container';
      pContainer.style.display = 'flex';
      pContainer.style.alignItems = 'center';
      pContainer.style.justifyContent = 'center';
      pContainer.appendChild(p);

      pContainer.style.transform = `rotate(${label.rotation}deg)`;
  
      const cPointLabel = new CSS2DObject(wrapper);
      cPointLabel.position.copy(position);
      cPointLabel.userData.type = label.type
      cPointLabel.userData.id = label.id
      // CSS2D stacking precedence: three's CSS2DRenderer assigns element
      // z-index by sorting on renderOrder first (higher renders on top), then
      // camera distance — so this is the only reliable way to control overlap.
      // Result min/max tags ('effort') must always paint above support
      // hexagons sharing the same node; support symbols stay below every
      // other annotation.
      cPointLabel.renderOrder = (label.type === 'effort' || label.type === 'reaction') ? 10 : (label.type === 'support' ? 0 : 5);
      this.model.scene.add(cPointLabel);
      this.labelObjects.push(cPointLabel);
    }
  }

  deleteAll(type : 'effort' | 'load' | 'reaction') {
    this.labelObjects.forEach(label => {
      if(label.userData.type === type) {
        label.element.remove();
        label.removeFromParent();
      }
    })  
    this.labelObjects = this.labelObjects.filter(label => label.userData.type !== type);
  }

  dispose() {
    this.labelObjects.forEach(label => {
      label.element.remove();
      label.removeFromParent();
    });
    this.labelObjects = [];
    this.renderer.domElement.remove();
    this.setupEvent = false
  }

  updateOne(label : Label) {
    const labelObj = this.labelObjects.find(labelObj => labelObj.userData.id === label.id);
    if(labelObj) {
      if(labelObj.userData.type !== label.type){
        this.deleteOne(label.id)
        this.create([label])
        return
      }
      const container = labelObj.element.childNodes[0] as HTMLElement
      // Refresh the inner <p> text node so the label keeps its styled font/color
      // (setting textContent on the container would wipe the <p> styling).
      const p = container?.querySelector('p') as HTMLElement
      if (p) p.textContent = label.text
      else if (container) container.textContent = label.text
      // Keep the label rotated along the symbol direction every frame so it
      // still follows the arrow when the camera orbits / zooms.
      if (container && label.rotation !== undefined) {
        container.style.transform = `rotate(${label.rotation}deg)`
      }
      labelObj.position.copy(label.position);
      const currentLayers = this.model.camera.cam.layers
      labelObj.layers = currentLayers
    }
  }

  batchUpdateOrCreate(labels : Label[]) {
    for(const label of labels){
      const labelObj = this.labelObjects.find(labelObj => labelObj.userData.id === label.id);
      if(labelObj) {
        this.updateOne(label)
      } else {
        this.create([label])
      }
    }
  }

  deleteOne(id: string) {
    const label = this.labelObjects.find(label => label.userData.id === id);
    if(label) {
      label.element.remove();
      label.removeFromParent();
      this.labelObjects = this.labelObjects.filter(label => label.userData.id !== id);
    }
  }

  batchDelete(ids: string[]) {
    this.labelObjects.forEach(label => {
      if(ids.includes(label.userData.id)) {
        console.log('deleting label', label.userData.id)
        label.element.remove();
        label.removeFromParent();
      }
    })
    this.labelObjects = this.labelObjects.filter(label => !ids.includes(label.userData.id));
  }
}

export default Labeler