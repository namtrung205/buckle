from ast import Continue, mod
from enum import auto
import os
os.environ['FOR_DISABLE_CONSOLE_CTRL_HANDLER'] = '1'

from pydantic import BaseModel
from typing import List
import math
import openseespy.opensees as ops
import uvicorn
from fastapi import FastAPI, HTTPException
import random
from .helpers import compute_section_properties
import numpy as np
import json
import threading
import time
from .settings import *
# Export public API
__all__ = ['run_analysis']


mm = 1E-3
m = 1 

def print_model_for_inspection(model: dict):
    """Prints the full model data in a readable format for debugging."""
    print("\n" + "="*80)
    print("MODEL DATA FOR INSPECTION (DPBSV Error Debug)")
    print("="*80 + "\n")
    
    print("NODES:")
    print(json.dumps(model.get('nodes', []), indent=2, default=str))
    print("\n" + "-"*80 + "\n")
    
    print("MEMBERS:")
    print(json.dumps(model.get('members', []), indent=2, default=str))
    print("\n" + "-"*80 + "\n")
    
    print("MATERIALS:")
    print(json.dumps(model.get('materials', []), indent=2, default=str))
    print("\n" + "-"*80 + "\n")
    
    print("SECTIONS:")
    print(json.dumps(model.get('sections', []), indent=2, default=str))
    print("\n" + "-"*80 + "\n")
    
    print("BOUNDARY CONDITIONS:")
    print(json.dumps(model.get('boundary_conditions', []), indent=2, default=str))
    print("\n" + "-"*80 + "\n")
    
    print("LOADS:")
    print(json.dumps(model.get('loads', []), indent=2, default=str))
    print("\n" + "="*80 + "\n")


# Global lock to ensure only one analysis runs at a time (OpenSees is a singleton)
analysis_lock = threading.Lock()

def run_analysis(model: dict, log_callback=None):
  # Use acquire with a timeout of 60 seconds to prevent total hang
  
  def _log(msg: str):
      print(msg, flush=True)
      if log_callback:
          log_callback(msg)
          
  acquired = analysis_lock.acquire(timeout=60)
  if not acquired:
      raise HTTPException(status_code=503, detail="Analysis engine is busy. Please try again in a few seconds.")
      
  try:
    start_total_time = time.time()
    global output
    output = {}
    output['nodes'] = []
    output['members'] = []
    nodes = model['nodes']
    members = model['members']
    # materials = model['materials']
    sections = model['sections']
    shells = model.get('shells', [])
    loads = model['loads']
    boundary_conditions = model['boundary_conditions']
    
    _log(f"\n[ANALYSIS] Starting structural analysis...")
    _log(f"[ANALYSIS] Input Summary: {len(nodes)} nodes, {len(members)} members, {len(shells)} shells, {len(sections)} sections, {len(loads)} loads, {len(boundary_conditions)} boundary conditions")

    # Fail fast with a descriptive error when the structure contains
    # rigid-body mechanisms (otherwise the solvers only report a cryptic
    # "failed to converge at step 1" without pointing at the cause)
    check_rigid_body_stability(members, shells, boundary_conditions, nodes, _log)
    # Initialize
    t0 = time.time()
    init()
    _log(f"[ANALYSIS] ✓ Model initialized (3D, 6 DOF per node) in {time.time()-t0:.3f}s")
    
    # Create nodes
    t0 = time.time()
    create_nodes(nodes)
    _log(f"[ANALYSIS] ✓ Created {len(nodes)} nodes in {time.time()-t0:.3f}s")

    # Create transformation for beam-column elements
    t0 = time.time()
    create_geometric_transformation(members)
    _log(f"[ANALYSIS] ✓ Created geometric transformations for {len(members)} members in {time.time()-t0:.3f}s")

    # Create sections 
    t0 = time.time()
    create_sections(sections)
    _log(f"[ANALYSIS] ✓ Created {len(sections)} sections in {time.time()-t0:.3f}s")
    
    # Create elements
    t0 = time.time()
    create_members(members)
    create_shells(shells)
    _log(f"[ANALYSIS] ✓ Created elements (members + {len(shells)} shells) in {time.time()-t0:.3f}s")

    # Apply boundary conditions
    t0 = time.time()
    apply_boundary_conditions(boundary_conditions)
    _log(f"[ANALYSIS] ✓ Applied boundary conditions to {len(boundary_conditions)} constraint(s) in {time.time()-t0:.3f}s")
    
    # Apply loads
    t0 = time.time()
    apply_loads(loads)
    _log(f"[ANALYSIS] ✓ Applied {len(loads)} load case(s) in {time.time()-t0:.3f}s")
    
    # Run the analysis
    _log("[ANALYSIS] Starting static analysis...")
    t0 = time.time()
    run_static_analysis(model, _log)
    _log(f"[ANALYSIS] ✓ Static analysis completed in {time.time()-t0:.3f}s")

    # Extract results
    t0 = time.time()
    extract_results(_log)
    _log(f"[ANALYSIS] ✓ Results extracted in {time.time()-t0:.3f}s")
    # print('output: ', output)
    
    # Clean up
    t0 = time.time()
    ops.wipe()
    _log(f"[ANALYSIS] ✓ Model cleaned up in {time.time()-t0:.3f}s")
    
    _log(f"[ANALYSIS] ✓ Total analysis time: {time.time() - start_total_time:.3f}s")
    return output

  except Exception as e:
      error_msg = str(e)
      # Check if this is a DPBSV error
      if "DPBSV" in error_msg or "illegal value" in error_msg.lower() or "singular" in error_msg.lower():
          print("\n!!! SINGULARITY OR DPBSV ERROR DETECTED - Printing model for inspection !!!")
          print_model_for_inspection(model)
      print('ERROR: ', e)
      raise HTTPException(status_code=500, detail=str(e))
  finally:
      # Always release the lock
      analysis_lock.release()

def init():
    """Initializes a new OpenSees 3D model."""
    ops.wipe()
    ops.model('basic', '-ndm', 3, '-ndf', 6)

def get_local_axis(nodei, nodej, vecxz=None):

    pi = np.array(ops.nodeCoord(nodei))
    pj = np.array(ops.nodeCoord(nodej))

    vecx = pj - pi
    
    length = np.linalg.norm(vecx)
    
    if length < 1e-10:
        raise ValueError("Member has zero length")

    vecx = vecx / length
    vecz = np.array(vecxz)
    vecy = np.cross(vecz, vecx)
    
    return [vecx, vecy, vecz]

def calculate_vecxz(member):
    """
    Calculate vecxz (local z-axis vector) for a member if not provided.
    Mirrors the _vecxz() logic from frontend ElasticBeamColumn.ts

    For horizontal members: vecz = [0, 0, 1] (global Z-axis)
    For vertical members: vecz = [1, 0, 0] (global X-axis)
    """
    vecxz = member.get('vecxz', None)
    if vecxz:
        return vecxz

    # Get node coordinates
    nodei = np.array([member['nodei']['x'], member['nodei']['y'], member['nodei']['z']])
    nodej = np.array([member['nodej']['x'], member['nodej']['y'], member['nodej']['z']])

    # Calculate local x-axis (along member)
    local_vecx = nodej - nodei
    local_vecx = local_vecx / np.linalg.norm(local_vecx)

    # Default up vector for horizontal members
    up = np.array([0, 1, 0])

    # Calculate cross product
    cross_vec = np.cross(up, local_vecx)
    cross_length = np.linalg.norm(cross_vec)

    # Determine local z-axis based on member orientation
    if cross_length < 1e-6:  # Element is parallel to the "up" vector (JSON Y)
        # Try local X-axis (JSON X) as fallback for vertical members
        fallback_up = np.array([1, 0, 0])
        cross_fallback = np.cross(fallback_up, local_vecx)
        if np.linalg.norm(cross_fallback) < 1e-6:
            # If still parallel, use JSON Z as fallback
            vecxz_json = np.array([0, 0, 1])
        else:
            vecxz_json = fallback_up
    else:  # Normal horizontal or inclined member
        vecxz_json = np.array([0, 0, 1])
        
    # Swap coordinates for OpenSees: JSON (vx, vy, vz) -> OpenSees (vx, vz, vy)
    vecxz_ops = [float(vecxz_json[0]), float(vecxz_json[2]), float(vecxz_json[1])]
    member['vecxz'] = vecxz_ops
    return vecxz_ops

def create_geometric_transformation(members):
    """Creates a linear geometric transformation for beam-column elements."""
    for member in members:
        vecxz = calculate_vecxz(member)
        ops.geomTransf("Linear", member['id'], *vecxz)

def create_sections(sections):
    """Creates a section for the beam-column elements."""
    for section in sections:
        properties = compute_section_properties(section)
        E = properties['E']
        A = properties['A']
        Iz = properties['Iz']
        Iy = properties['Iy']
        Jxx = properties['Jxx']
        G_mod  = properties['G_mod']
        ops.section('Elastic', section['id'], E, A, Iz, Iy, G_mod, Jxx)

def create_nodes(nodes):
  """Creates nodes in the OpenSees model and returns a set of node IDs."""
  node_ids = set()
  for node in nodes:
    ops.node(node['id'], node['x'], node['z'], node['y'])
    node_ids.add(node['id'])
    
    output['nodes'].append({
        'id': node['id'],
        'x': node['x'],
        'y': node['y'],
        'z': node['z']
    })
  
def get_release(release_type):
  if not release_type:
    return None, None
  # Usually 'pinned' means releasing bending moments (ry, rz), NOT torsion (rx)!
  # Releasing rx at both ends would create a singular matrix (unrestrained spin)
  if release_type == 'fixed-pinned':
    return None, {'ry': 0, 'rz': 0}
  elif release_type == 'pinned-fixed':
    return {'ry': 0, 'rz': 0}, None
  elif release_type == 'pinned-pinned':
    return {'ry': 0, 'rz': 0}, {'ry': 0, 'rz': 0}
  else:
    return None, None

def get_release_node(member, node_id, releases):
  
    nodei = member['nodei']['id']
    nodej = member['nodej']['id']
    vecxz = member.get('vecxz')
    
    local_matrix = get_local_axis(nodei, nodej, vecxz)
    vecx = local_matrix[0]  # Local x-axis (along member)
    vecy = local_matrix[1]  # Local y-axis
    vecz = local_matrix[2]  # Local z-axis
    
    i_node = node_id
    
    j_node = int(random.random() * 0x7FFFFFFF)
    coords = ops.nodeCoord(i_node)
    ops.node(j_node, coords[0], coords[1], coords[2])
    
    released_dofs = []
    constrained_dofs = []
    materials = []
    
    # Stiffness for released DOFs (small enough to act as a hinge, but large enough for double precision)
    k_release = 1e-4
    
    # DOF mapping
    dof_mapping = {
      'fx': 1, 'fy': 2, 'fz': 3,  # Translations
      'rx': 4, 'ry': 5, 'rz': 6   # Rotations
    }
    
    # Check each DOF
    for dof_name, dof_number in dof_mapping.items():
      # Default to fixed (1) if not specified
      is_released = releases.get(dof_name, 1) == 0
      
      if is_released:
        released_dofs.append(dof_number)
        mat_id = int(random.random() * 0x7FFFFFFF)
        ops.uniaxialMaterial("Elastic", mat_id, k_release)
        materials.append(mat_id)
      else:
        constrained_dofs.append(dof_number)

    if released_dofs:
      zero_length_id = int(random.random() * 0x7FFFFFFF)
      
      ops.element("zeroLength", zero_length_id, i_node, j_node,
                  "-mat", *materials,
                  "-dir", *released_dofs,
                  "-orient", vecx[0], vecx[1], vecx[2], vecy[0], vecy[1], vecy[2])

      if constrained_dofs:
          ops.equalDOF(i_node, j_node, *constrained_dofs)
    
    return j_node

def create_members(members):
    
  """Creates elements by discretizing members into segments."""
  for member in members:
    # print('create_members member: ', member)
    parent_id = member['id'] 
    geoTransf_id = parent_id
    new_nodes, new_members, length = mesh_member(member)
    
    # Get release type and convert to DOF specifications
    release_type = member.get('release')
    releases_i, releases_j = get_release(release_type)
    
    original_start_node = member['nodei']['id']
    original_end_node = member['nodej']['id']
    
    release_start_node = None
    release_end_node = None
    
    if releases_i:
      release_start_node = get_release_node(member, original_start_node, releases_i)

    if releases_j:
      release_end_node = get_release_node(member, original_end_node, releases_j)

    for idx, new_member in enumerate(new_members):
      child_id = new_member['id']
      node_i = new_member['nodei']
      node_j = new_member['nodej']
      section_id = member['section']

      if idx == 0 and release_start_node:
        node_i = release_start_node

      if idx == len(new_members) - 1 and release_end_node:
        node_j = release_end_node

      ops.element("elasticBeamColumn", child_id, node_i, node_j, section_id , geoTransf_id)
      
    output['members'].append({
        'id': parent_id,
        'mesh': {
          'nodes': new_nodes,
          'members': new_members
        },
        'vecxz': member['vecxz'],
        'length' : length
    })  
     
def mesh_member(member):
    """Discretizes a member into segments and creates nodes and elements."""
    ni = member['nodei']
    nj = member['nodej']
    section_id = member['section']
    model_nodes_ids = [node['id'] for node in output['nodes']]

    # Ensure the input nodes exist in the model
    if ni['id'] not in model_nodes_ids or nj['id'] not in model_nodes_ids:
        raise HTTPException(status_code=400, detail=f"Member {member['id']} references undefined node(s).")
    
    # Compute the total length of the member
    L = math.sqrt((nj['x'] - ni['x'])**2 + (nj['y'] - ni['y'])**2 + (nj['z'] - ni['z'])**2)
    
    # Determine the number of segments
    num_segments = math.ceil(L / 0.5)
    
    # Generate the list of node IDs along the member
    new_nodes = [{
      'id': ni['id'],
      'x': ni['x'],
      'y': ni['z'],
      'z': ni['y']
    }]
      
    # Generate interior nodes via linear interpolation
    for i in range(1, num_segments):
        fraction = i / num_segments
        x_coord = ni['x'] + fraction * (nj['x'] - ni['x'])
        y_coord = ni['y'] + fraction * (nj['y'] - ni['y'])
        z_coord = ni['z'] + fraction * (nj['z'] - ni['z'])

        # print('x_coord: ', x_coord)
        # print('y_coord: ', y_coord)
        # print('z_coord: ', z_coord)

        node_id = int(random.random() * 0x7FFFFFFF)
        ops.node(node_id, x_coord, z_coord, y_coord)
        
        output['nodes'].append({
            'id': node_id,
            'x': x_coord, 
            'y': y_coord,
            'z': z_coord
        })
        
        new_nodes.append({
          'id': node_id,
          'x': x_coord,
          'y': y_coord,
          'z': z_coord
        })
    
    # Append the provided ending node
    new_nodes.append({
      'id': nj['id'],
      'x': nj['x'],
      'y': nj['y'],
      'z': nj['z']
    })
    
    # Create elements between consecutive nodes
    new_members = []
    number_of_members = len(new_nodes) - 1
    for k in range(number_of_members):
      member_id = int(random.random() * 0x7FFFFFFF)
      new_members.append({
          'id': member_id,
          'nodei': new_nodes[k]['id'],
          'nodej': new_nodes[k+1]['id'],
          'section': section_id
      })

    return new_nodes, new_members, L

def create_shells(shells):
  """Creates ShellMITC4 elements in the OpenSees model."""
  for shell in shells:
    shell_id = shell['id']
    nodes = shell['nodes']
    thickness = shell.get('thickness', 0.005) # Default 5mm
    material = shell.get('material', {'E': 2.1e11, 'nu': 0.3})
    
    # Skip degenerate shells (duplicate nodes — e.g. triangular gable passed as quad)
    if len(set(nodes)) < len(nodes):
        print(f"Warning: Shell {shell_id} has duplicate node IDs {nodes} — skipping degenerate element")
        continue
    
    # Skip any shell that is not exactly 4 unique nodes
    if len(nodes) != 4:
        print(f"Warning: Shell {shell_id} has {len(nodes)} nodes (expected 4 for ShellMITC4). Skipping.")
        continue
    
    # Create a unique section for this shell (simpler for now)
    # OpenSees section 'ElasticMembranePlateSection' tag E nu h rho
    section_tag = int(random.random() * 0x7FFFFFFF)
    E = material.get('E', 2.1e11)
    nu = material.get('nu', 0.3)
    rho = material.get('rho', 7850.0)
    
    ops.section('ElasticMembranePlateSection', section_tag, E, nu, thickness, rho)
    ops.element('ShellMITC4', shell_id, *nodes, section_tag)

def apply_boundary_conditions(boundary_conditions):
  """Applies boundary conditions to the model."""
  for (i, boundary_condition) in enumerate(boundary_conditions):
    targets = boundary_condition['targets']
    bdc_type = boundary_condition['type']
    dx = boundary_condition['dx']
    dy = boundary_condition['dy']
    dz = boundary_condition['dz']
    rx = boundary_condition['rx']
    ry = boundary_condition['ry']
    rz = boundary_condition['rz']
    for target in targets:
    
      j_coord = ops.nodeCoord(target)
      
      if(bdc_type == "elastic"):
        support_node = int(random.random() * 0x7FFFFFFF)
        ops.node(support_node, j_coord[0], j_coord[1], j_coord[2])
      
        kx = dx   # Spring stiffness in X direction
        ky = dy   # Spring stiffness in Y direction  
        kz = dz   # Spring stiffness in Z direction
        krx =  rx # Rotational spring stiffness about X
        kry =  ry # Rotational spring stiffness about Y
        krz =  rz # Rotational spring stiffness about Z
        
        # Create spring materials for each DOF
        mat_ids = []
        for dof_idx, stiffness in enumerate([kx, ky, kz, krx, kry, krz], start=1):
            mat_id = int(random.random() * 0x7FFFFFFF)
            ops.uniaxialMaterial("Elastic", mat_id, stiffness)
            mat_ids.append(mat_id)
        
        zero_length_id = int(random.random() * 0x7FFFFFFF)
        ops.element("zeroLength", zero_length_id, target, support_node, 
                    "-mat", *mat_ids,
                    "-dir", 1, 2, 3, 4, 5, 6)
        
        # Fix the support node (ground)
        ops.fix(support_node, 1, 1, 1, 1, 1, 1)
    else:      
        # Swap fixity: OpenSees coord 2 = JSON Z, OpenSees coord 3 = JSON Y
        # JSON (dx, dy, dz, rx, ry, rz) -> OpenSees (dx, dz, dy, rx, rz, ry)
        ops.fix(target, dx, dz, dy, rx, rz, ry)

def calculate_quad_area_and_normal(node_coords):
    """
    Computes area and normal vector of a 4-node quad by splitting it into 2 triangles.
    node_coords: [[x1,z1,y1], [x2,z2,y2], [x3,z3,y3], [x4,z4,y4]] (OpenSees coords)
    Returns: (area, normal_vector)
    """
    pts = [np.array(c) for c in node_coords]
    # Triangle 1: 0-1-2
    v1 = pts[1] - pts[0]
    v2 = pts[2] - pts[0]
    cp1 = np.cross(v1, v2)
    a1 = 0.5 * np.linalg.norm(cp1)
    
    # Triangle 2: 0-2-3
    v3 = pts[2] - pts[0]
    v4 = pts[3] - pts[0]
    cp2 = np.cross(v3, v4)
    a2 = 0.5 * np.linalg.norm(cp2)
    
    total_area = a1 + a2
    # Weighted average normal
    if total_area > 1e-12:
        normal = (cp1 + cp2) / (np.linalg.norm(cp1 + cp2) + 1e-16)
    else:
        normal = np.array([0, 0, 0])
        
    return total_area, normal

def check_rigid_body_stability(members, shells, boundary_conditions, nodes, log_callback=None):
  """Fail-fast check for rigid-body mechanisms before running the analysis.

  Groups the structure into connected components (nodes joined by members or
  shells) and counts the restrained DOFs contributed by rigid supports in each
  component. A component with fewer than 6 restrained DOFs and no elastic
  (spring) support is guaranteed to be a mechanism: the stiffness matrix is
  unsolvable and every solver reports a cryptic "failed to converge" error.
  Raising a descriptive error here pinpoints the under-restrained part instead.
  """
  def _log(msg: str):
    print(msg, flush=True)
    if log_callback: log_callback(msg)

  parent = {}
  def find(a):
    parent.setdefault(a, a)
    root = a
    while parent[root] != root:
      root = parent[root]
    while parent[a] != root:
      parent[a], a = root, parent[a]
    return root
  def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
      parent[ra] = rb

  # Seed every known node so floating nodes form their own component
  for node in nodes:
    find(node['id'])
  for member in members:
    union(member['nodei']['id'], member['nodej']['id'])
  for shell in shells:
    shell_nodes = shell.get('nodes') or []
    for nid in shell_nodes[1:]:
      union(shell_nodes[0], nid)

  restrained = {}
  elastic_roots = set()
  for bc in boundary_conditions:
    targets = bc.get('targets', [])
    if bc.get('type') == 'elastic':
      # Springs add stiffness, not restraints — remember them separately
      for t in targets:
        if t in parent:
          elastic_roots.add(find(t))
      continue
    flags = sum(1 for k in ('dx', 'dy', 'dz', 'rx', 'ry', 'rz') if bc.get(k))
    for t in targets:
      if t in parent:
        root = find(t)
        restrained[root] = restrained.get(root, 0) + flags

  # Warn about coincident nodes: they are almost always accidental duplicates
  # (e.g. a missed node snap while drawing), and members attached to separate
  # nodes at the same location are structurally disconnected.
  names = {n['id']: (n.get('name') or str(n['id'])) for n in nodes}
  tol = 1e-6
  warned_pairs = set()
  for i in range(len(nodes)):
    for j in range(i + 1, len(nodes)):
      a, b = nodes[i], nodes[j]
      if (abs(a['x'] - b['x']) < tol and abs(a['y'] - b['y']) < tol
          and abs(a['z'] - b['z']) < tol):
        pair = tuple(sorted((a['id'], b['id'])))
        if pair not in warned_pairs:
          warned_pairs.add(pair)
          _log(f"[ANALYSIS] Warning: {names.get(a['id'], a['id'])} and "
               f"{names.get(b['id'], b['id'])} are at the same coordinates but are "
               f"separate nodes — elements connected to them are structurally "
               f"disconnected. Merge the nodes or re-draw with node snap enabled.")

  unstable = []
  for root in {find(nid) for nid in parent}:
    fixed = restrained.get(root, 0)
    if fixed >= 6 or root in elastic_roots:
      continue
    component = sorted(nid for nid in parent if find(nid) == root)
    unstable.append((component, fixed))

  if unstable:
    names = {n['id']: (n.get('name') or str(n['id'])) for n in nodes}
    parts = []
    for component, fixed in unstable:
      listed = ', '.join(names.get(nid, str(nid)) for nid in component[:10])
      extra = '' if len(component) <= 10 else f' (+{len(component) - 10} more nodes)'
      parts.append(f"{listed}{extra} -> only {fixed}/6 restraints")
    raise Exception(
      "Structure is unstable (rigid-body mechanism): some parts are not fully "
      "restrained, so the stiffness matrix cannot be solved. Unstable parts: "
      + ' | '.join(parts)
      + ". Fix the supports (each independent part needs at least 6 restrained "
        "DOFs, e.g. restrain Dx/Dy/Dz and Rx/Ry/Rz) or connect the part to an "
        "already stable part."
    )

  # Components that only stay stable thanks to spring supports: warn only
  warned = False
  for root in elastic_roots:
    if restrained.get(root, 0) < 6 and not warned:
      _log("[ANALYSIS] Warning: some parts rely on elastic (spring) supports for stability — verify results carefully.")
      warned = True

def apply_loads(loads):
    """Applies loads to the model."""
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    members = output['members']
    nodes = output['nodes']
    total_pressure_nodes = set()
    total_loads_applied = 0

    _log_info = lambda msg: print(msg, flush=True)
    _log_info(f"[LOADS] Processing {len(loads)} load case(s):")
    for i, load in enumerate(loads):
        _log_info(f"  [{i+1}] type='{load.get('type')}' name='{load.get('name')}' targets={len(load.get('targets',[]))} magnitude={load.get('magnitude')} value={load.get('value')}")

    for load in loads:
      targets = load['targets']
      value = load.get('value') or {}  # Safe fallback: pressure loads may omit 'value'
      if(load['type'] == 'linear'):
        for id in targets:
          member = next((e for e in members if e['id'] == id), None)
          if member:
            mesh = member['mesh']
            nodes = mesh['nodes']
            length = member['length']

            number_of_nodes = len(nodes)
            for (j, node) in enumerate(nodes):
              node_id = node['id']
              distance_between_nodes = length / (number_of_nodes - 1)

              # Calculate load based on node position
              if j == 0 or j == number_of_nodes - 1:  # First or last node
                nDelta = distance_between_nodes / 2
              else:  # Interior nodes
                nDelta = distance_between_nodes
              # Apply load (note: coordinate swapping for y and z)
              fx = value['x'] * nDelta * 1E3
              fy = value['z'] * nDelta * 1E3
              fz = value['y'] * nDelta * 1E3
              ops.load(node_id, fx, fy, fz, 0.0, 0.0, 0.0)
      elif(load['type'] == 'nodal'):
        for id in targets:
          node = next((e for e in nodes if e['id'] == id), None)
          if node:
            fx = value['x'] * 1E3
            fy = value['z'] * 1E3
            fz = value['y'] * 1E3
            ops.load(id, fx, fy, fz, 0.0, 0.0, 0.0)
      elif(load['type'] == 'pressure'):
        # Pressure load: kN/m2 on shell elements
        # JSON coords: x=X, y=up, z=depth
        # OpenSees coords: 1=X, 2=JSON_Z (depth), 3=JSON_Y (up/vertical)
        for shell_id in targets:
          try:
            # Find the nodes of the shell
            shell_nodes = ops.eleNodes(shell_id)
            if not shell_nodes or len(shell_nodes) != 4:
                continue
            
            # Get coordinates for area/normal calculation
            coords = [ops.nodeCoord(n) for n in shell_nodes]
            area, normal = calculate_quad_area_and_normal(coords)
            
            # Treat None/missing magnitude as 0 (vector load path)
            magnitude = load.get('magnitude', 0)
            if magnitude is None:
                magnitude = 0

            if magnitude == 0 and isinstance(value, dict):
                # Vector load (e.g. Snow): value is in JSON coords (x, y=up, z=depth)
                # Convert JSON -> OpenSees: fy_ops = value_z_json, fz_ops = value_y_json
                fx_total = value.get('x', 0) * area * 1000
                fy_total = value.get('z', 0) * area * 1000  # JSON Z -> OPS Y
                fz_total = value.get('y', 0) * area * 1000  # JSON Y (vertical) -> OPS Z
                print(f"[LOAD] Shell {shell_id}: Snow/vector load area={area:.3f}m², F=({fx_total:.1f},{fy_total:.1f},{fz_total:.1f})N")
            else:
                # Scalar magnitude (e.g. Wind): normal pressure perpendicular to surface
                force_vec = float(magnitude) * area * 1000 * normal
                fx_total, fy_total, fz_total = force_vec[0], force_vec[1], force_vec[2]
                print(f"[LOAD] Shell {shell_id}: Wind/scalar load magnitude={magnitude} area={area:.3f}m², F=({fx_total:.1f},{fy_total:.1f},{fz_total:.1f})N")
            
            # Distribute equally to 4 corner nodes
            for node_id in shell_nodes:
                ops.load(node_id, fx_total/4.0, fy_total/4.0, fz_total/4.0, 0.0, 0.0, 0.0)
                
          except Exception as e:
            print(f"Warning: Failed to apply pressure load to shell {shell_id}: {e}")

def run_static_analysis(model: dict = None, log_callback=None):
    """Sets up and runs the static analysis."""
    def _log(msg: str):
        print(msg, flush=True)
        if log_callback: log_callback(msg)

    try:
        # Check system health
        num_nodes = len(ops.getNodeTags())
        num_elements = len(ops.getEleTags())
        _log(f"[ANALYSIS] Model statistics: {num_nodes} nodes, {num_elements} elements")
        
        # UmfPack handles unsymmetric/ill-conditioned systems from shell drilling DOF
        # common in mixed shell+beam models
        solver_set = False
        for solver in ["UmfPack", "SparseSYM", "BandGenLinLapack", "FullGeneral"]:
            try:
                ops.system(solver)
                _log(f"[ANALYSIS] Using solver: {solver}")
                solver_set = True
                break
            except:
                continue
        if not solver_set:
            ops.system("FullGeneral")
            _log("[ANALYSIS] Warning: Falling back to FullGeneral solver")
        
        ops.numberer("RCM")
        # Penalty is more stable than Transformation for mixed shell+beam models
        # with shared nodes — avoids DOF elimination issues from drilling DOF
        ops.constraints("Penalty", 1.0e12, 1.0e12)
        
        # Apply load in multiple steps
        num_steps = 10
        load_step = 1.0 / num_steps
        
        ops.integrator("LoadControl", load_step)
        ops.test("NormDispIncr", 1.0e-6, 100)
        ops.algorithm("Newton")
        ops.analysis("Static")
        
        # Perform the analysis step-by-step to show progress
        for i in range(num_steps):
            ok = ops.analyze(1)
            
            # Fallback 1: KrylovNewton — better for ill-conditioned systems
            if ok != 0:
                _log(f"[ANALYSIS]   > Newton failed at step {i+1}, trying KrylovNewton...")
                ops.test("NormDispIncr", 1.0e-4, 200)
                ops.algorithm("KrylovNewton")
                ok = ops.analyze(1)
                ops.test("NormDispIncr", 1.0e-6, 100)
                ops.algorithm("Newton")
            
            # Fallback 2: ModifiedNewton with energy convergence criterion
            if ok != 0:
                _log(f"[ANALYSIS]   > KrylovNewton failed at step {i+1}, trying ModifiedNewton+EnergyIncr...")
                ops.test("EnergyIncr", 1.0e-8, 200)
                ops.algorithm("ModifiedNewton")
                ok = ops.analyze(1)
                ops.test("NormDispIncr", 1.0e-6, 100)
                ops.algorithm("Newton")
            
            if ok != 0:
                _log(f"[ANALYSIS]   > Analysis failed to converge at step {i+1}")
                raise Exception(f"Analysis failed to converge at step {i+1}")
            else:
                _log(f"[ANALYSIS]   > Completed load step {i+1}/{num_steps}")
                
        return 0
    except Exception as e:
        error_msg = str(e)
        _log(f"[ANALYSIS ERROR] {error_msg}")
        # Check if this is a DPBSV error
        if "DPBSV" in error_msg or "illegal value" in error_msg.lower():
            print("\n!!! DPBSV ERROR DETECTED IN run_static_analysis - Printing model for inspection !!!")
            if model:
                print_model_for_inspection(model)
        raise

def extract_node_displacements():
  """Extracts displacement data for all nodes."""
  nodes = output['nodes']

  for node in nodes:
    node_id = node['id']
    try:
      disp = ops.nodeDisp(node_id) 
      node['displacements'] = {
        'ux': round(disp[0], 5),  
        'uy': round(disp[1], 5),    
        'uz': round(disp[2], 5),  
        'rx': round(disp[3], 5),  
        'ry': round(disp[4], 5),  
        'rz': round(disp[5], 5),
      }

      
    except Exception as e:
      print(f"Warning: Could not extract displacement for node {node_id}: {e}")

def extract_results(log_callback=None):
  """Extracts and processes results from the analysis."""
  def _log(msg: str):
      print(msg, flush=True)
      if log_callback: log_callback(msg)
      
  members = output['members']
  
  _log(f"[ANALYSIS]   > Extracting displacements for {len(output['nodes'])} nodes...")
  extract_node_displacements()

  _log(f"[ANALYSIS]   > Extracting internal forces for {len(members)} structural members...")
  
  total_members = len(members)
  log_interval = max(1, total_members // 10) # Log every 10%
  
  for idx, member in enumerate(members):
    if (idx + 1) % log_interval == 0 or idx == total_members - 1:
        _log(f"[ANALYSIS]     ... processed sections for {idx + 1}/{total_members} members")
        
    mesh = member['mesh']
    nodes = mesh['nodes']
    child_members = mesh['members']
    node_efforts_dict = {}
    stations_dict = {}

    forces = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz']
    nep_stations = 11  # evaluation points per child element -> smooth diagrams + hover readouts
    for child_member in child_members:
      child_id = child_member['id']
      
      try:
        ele_node_tags = ops.eleNodes(child_id)
        if not ele_node_tags or len(ele_node_tags) < 2:
          print(f"Warning: Element {child_id} has invalid node tags: {ele_node_tags}")
          continue
          
        node_i = ele_node_tags[0]
        node_j = ele_node_tags[1]

        node_i_coord = ops.nodeCoord(node_i)
        node_j_coord = ops.nodeCoord(node_j)
      except Exception as e:
        print(f"Warning: Failed to get nodes/coordinates for element {child_id}: {e}")
        continue

      # Initialize node efforts dictionaries if they don't exist
      if node_i not in node_efforts_dict:
          node_efforts_dict[node_i] = {
              "node": node_i,
              "efforts": {},
              "coord": node_i_coord,
          }
      
      if node_j not in node_efforts_dict:
          node_efforts_dict[node_j] = {
              "node": node_j,
              "efforts": {},
              "coord": node_j_coord,
          }

      # Process each force type
      for force in forces:
        try:
          data = extract_section_force_data(child_id, force, sfac=1E-5, nep=nep_stations, dir_plt=0)
          force_values = data['force_values']
          displaced_positions = data['displaced_positions']
          base_positions = data.get('base_positions')
          
          # Determine unit based on force type
          if force in ['N']:
            unit = "kN"
          elif force in ['Vy', 'Vz']:
            unit = "kN"
          elif force in ['T']:
            unit = "kNm"
          elif force in ['My', 'Mz']:
            unit = "kNm"
          else:
            unit = "kN"

          # Process node i
          if force not in node_efforts_dict[node_i]["efforts"]:
              node_efforts_dict[node_i]["efforts"][force] = {
                "value": np.round(force_values[0], 2),
                "unit": unit,
                "displaced_positions": displaced_positions[0]
              }
          else:
            # Average with existing value
            current_value = node_efforts_dict[node_i]["efforts"][force]["value"]
            mean_value = (current_value + force_values[0]) / 2
            node_efforts_dict[node_i]["efforts"][force]["value"] = np.round(mean_value, 2)
          
          # Process node j
          if force not in node_efforts_dict[node_j]["efforts"]:
            node_efforts_dict[node_j]["efforts"][force] = {
              "value": np.round(force_values[1], 2),
              "unit": unit,
              "displaced_positions": displaced_positions[1]
            }
          else:
            # Average with existing value
            current_value = node_efforts_dict[node_j]["efforts"][force]["value"]
            mean_value = (current_value + force_values[1]) / 2
            node_efforts_dict[node_j]["efforts"][force]["value"] = np.round(mean_value, 2)

          # Collect intermediate stations for smooth diagram rendering & hover readouts
          if base_positions is not None:
            for k in range(len(force_values)):
              key = tuple(np.round(base_positions[k], 6))
              value = float(np.round(force_values[k], 2))
              # Full-precision plot point: coord + value * SFAC * localAxis (per-force plane)
              plot_point = [float(c) for c in displaced_positions[k]]
              if key not in stations_dict:
                stations_dict[key] = {
                  "coord": np.round(base_positions[k], 6).tolist(),
                  "displaced": displaced_positions[k],
                  "values": {force: value},
                  "plot_points": {force: plot_point},
                }
              else:
                entry = stations_dict[key]
                if force in entry["values"]:
                  entry["values"][force] = float(np.round((entry["values"][force] + value) / 2, 2))
                  previous = entry["plot_points"].get(force)
                  if previous is not None:
                    entry["plot_points"][force] = [(previous[i] + plot_point[i]) / 2 for i in range(3)]
                else:
                  entry["values"][force] = value
                  entry["plot_points"][force] = plot_point

        except Exception as e:
          print(f"Warning: Could not extract {force} data for element {child_id}: {e}")
          continue
    
    member['node_efforts'] = list(node_efforts_dict.values())
    if stations_dict:
      member['stations'] = list(stations_dict.values())
    # member['plot_2d'] = plot_2d(member, forces)

  
def plot_2d(member, forces_to_plot=None):
  vecz = np.array([0, 0, 1])
  scale = 1
  mesh = member['mesh']
  nodes = mesh['nodes']
  number_of_nodes = len(nodes)
  node_efforts = member['node_efforts']
  output_plot = {}
  output_plot['efforts'] = {}

  nodei = np.array([nodes[0]['x'], nodes[0]['y'], nodes[0]['z']])
  nodej = np.array([nodes[-1]['x'], nodes[-1]['y'], nodes[-1]['z']])
  local_origin = nodei.copy()

  member_vector = nodej - nodei
  member_length = np.linalg.norm(member_vector)
  vec_x = member_vector / member_length

  angle_rad = np.arccos(np.clip(np.dot(vec_x, vecz), -1.0, 1.0))
  angle_deg = np.degrees(angle_rad)


  s_0 = []
  for node in node_efforts:
      coord = np.array(node['coord'])
      r_vec = coord - local_origin
      r = np.linalg.norm(r_vec)

      x2d = np.round(r * np.cos(np.pi / 2 - angle_rad), 3)
      y2d = np.abs(np.round(r * np.sin(np.pi / 2 - angle_rad), 3))
      s_0.append({'x': x2d, 'y': y2d , 'label' : f'x:{x2d} y:{y2d}'})

  nodei_2d = np.array([s_0[0]['x'], s_0[0]['y']])
  nodej_2d = np.array([s_0[-1]['x'], s_0[-1]['y']])
  vec_2d = (nodej_2d - nodei_2d) / member_length
  norm_vec = np.array([-vec_2d[1], vec_2d[0]])
  output_plot["s_0"] = s_0

  for i, node in enumerate(s_0):
      efforts = node_efforts[i]['efforts']
      coords = [node['x'], node['y']]
      for type, effort in efforts.items():
        value = effort['value']
        unit = effort['unit']
        offset_vector = -norm_vec * value * scale
        point = np.array(coords) + offset_vector
        if type not in output_plot['efforts']:
            output_plot['efforts'][type] = []
        output_plot['efforts'][type].append(
          {
            'x': point[0],
            'y': point[1],
            'label': f'{value} {unit}'
          }
        )

  return output_plot


def section_force_distribution_3d(ecrd, pl, nep=2,
                                  ele_load_data=[['-beamUniform', 0., 0., 0.]]):
    """
    Calculate section forces (N, Vy, Vz, T, My, Mz) for an elastic 3d beam.

    Longer description

    Parameters
    ----------

    ecrd : ndarray
        x, y, z element coordinates
    pl : ndarray
    nep : int
        number of evaluation points, by default (2) at element ends

    ele_load_list : list
        list of transverse and longitudinal element load
        syntax: [ele_load_type, Wy, Wz, Wx]
        For now only '-beamUniform' element load type is acceptable.

    Returns
    -------

    s : ndarray
        [N Vx Vy T My Mz]; shape: (nep,6)
        column vectors of section forces along local x-axis

    uvwfi : ndarray
        [u v w fi]; shape (nep,4)
        displacements at nep points along local x

    xl : ndarray
        coordinates of local x-axis; shape (nep,)

    nep : int
        number of evaluation points, by default (2) at element ends
        If the element load is between the points then nep is increased by 1 or 2

    Notes
    -----

    Todo: add '-beamPoint' element load type

    """
    Lxyz = ecrd[1, :] - ecrd[0, :]
    L = np.sqrt(Lxyz @ Lxyz)

    nlf = len(pl)
    xl = np.linspace(0., L, nep)

    for ele_load_data_i in ele_load_data:
        ele_load_type = ele_load_data_i[0]

        if nlf == 1:
            N1 = pl[0]
        elif nlf == 12:
            N1, Vy1, Vz1, T1, My1, Mz1 = pl[:6]
        else:
            print('\nWarning! Not supported. Number of nodal forces: {nlf}')

        if ele_load_type == '-beamUniform':
            n_ele_load_data = len(ele_load_data_i)

            if n_ele_load_data == 4:
                pass

        elif ele_load_type == '-beamPoint':
            Py, Pz, aL, Px = ele_load_data_i[1:5]
            a = aL * L

            if a in xl:
                xl = np.insert(xl, xl.searchsorted(a+0.001), a+0.001)
                nep += 1

            else:
                xl = np.insert(xl, xl.searchsorted(a), a)
                xl = np.insert(xl, xl.searchsorted(a+0.001), a+0.001)
                nep += 2

    one = np.ones(nep)

    N = -1. * (N1 * one)

    if nlf == 12:
        Vy = Vy1 * one
        Vz = Vz1 * one
        T = -T1 * one
        Mz = -Mz1 * one + Vy1 * xl
        My = -My1 * one - Vz1 * xl

        s = np.column_stack((N, Vy, Vz, T, My, Mz))

    elif nlf == 1:
        s = np.column_stack((N))

    for ele_load_data_i in ele_load_data:
        ele_load_type = ele_load_data_i[0]

        if ele_load_type == '-beamUniform':
            n_ele_load_data = len(ele_load_data_i)

            if n_ele_load_data == 4:
                Wy, Wz, Wx = ele_load_data_i[1:4]

                N = -1. * (Wx * xl)

                if nlf == 12:
                    Vy = Wy * xl
                    Vz = Wz * xl
                    T = np.zeros_like(one)
                    Mz = 0.5 * Wy * xl**2
                    My = -0.5 * Wz * xl**2

                    s += np.column_stack((N, Vy, Vz, T, My, Mz))

                elif nlf == 1:
                    s += np.column_stack((N))

        elif ele_load_type == '-beamPoint':
            Py, Pz, aL, Px = ele_load_data_i[1:5]
            a = aL * L

            indx = 0
            for x in np.nditer(xl):
                if x <= a:
                    pass
                elif x > a:
                    s[indx, 0] += -1. * Px
                    s[indx, 1] += Py
                    s[indx, 2] += Pz
                    s[indx, 4] += - Pz * (x - a)
                    s[indx, 5] += Py * (x - a)

                indx += 1

    return s, xl, nep


def section_force_distribution_2d(ecrd, pl, nep=2,
                                  ele_load_data=[['-beamUniform', 0., 0.]]):
    """
    Calculate section forces (N, V, M) for an elastic 2D Euler-Bernoulli beam.

    Input:
    ecrd - x, y element coordinates in global system
    nep - number of evaluation points, by default (2) at element ends
    ele_load_list - list of transverse and longitudinal element load
      syntax: [ele_load_type, Wy, Wx]
      For now only '-beamUniform' element load type is acceptable

    Output:
    s = [N V M]; shape: (nep,3)
        section forces at nep points along local x
    xl: coordinates of local x-axis; shape: (nep,)

    Use it with dia_sf to draw N, V, M diagrams.

    nep : int
        number of evaluation points, by default (2) at element ends
        If the element load is between the points then nep is increased by 1 or 2

    TODO: add '-beamPoint' element load type
    """


    Lxy = ecrd[1, :] - ecrd[0, :]
    L = np.sqrt(Lxy @ Lxy)

    nlf = len(pl)
    print('NFL', nlf)
    xl = np.linspace(0., L, nep)

    for ele_load_data_i in ele_load_data:
        ele_load_type = ele_load_data_i[0]

        if nlf == 1:  # trusses
            N_1 = pl[0]
        elif nlf == 6:  # plane frames
            # N_1, V_1, M_1 = pl[0], pl[1], pl[2]
            N_1, V_1, M_1 = pl[:3]
        else:
            print('\nWarning! Not supported. Number of nodal forces: {nlf}')

        if ele_load_type == '-beamUniform':
            # raise ValueError
            # raise NameError

            n_ele_load_data = len(ele_load_data_i)

            if n_ele_load_data == 3:
                # eload_type, Wy, Wx = ele_load_data[0], ele_load_data[1], ele_load_data[2]
                Wy, Wx = ele_load_data_i[1], ele_load_data_i[2]

            elif n_ele_load_data == 7:
                wta, waa, aL, bL, wtb, wab = ele_load_data_i[1:7]
                a, b = aL*L, bL*L

                bma = b - a

                if a in xl:
                    pass
                else:
                    xl = np.insert(xl, xl.searchsorted(a), a)
                    nep += 1
                if b in xl:
                    pass
                else:
                    xl = np.insert(xl, xl.searchsorted(b), b)
                    nep += 1

        elif ele_load_type == '-beamPoint':
            Pt, aL, Pa = ele_load_data_i[1:4]
            a = aL * L

            if a in xl:
                # idx = xl.searchsorted(a)
                # np.concatenate((xl[:idx], [a], xl[idx:]))
                xl = np.insert(xl, xl.searchsorted(a+0.001), a+0.001)
                nep += 1

            else:
                # idx = xl.searchsorted(a)
                # xl = np.concatenate((xl[:idx], [a], xl[idx:]))
                # idx = xl.searchsorted(a+0.001)
                # xl = np.concatenate((xl[:idx], [a+0.001], xl[idx:]))
                xl = np.insert(xl, xl.searchsorted(a), a)
                xl = np.insert(xl, xl.searchsorted(a+0.001), a+0.001)
                nep += 2

    # xl is modified on the fly
    one = np.ones(nep)

    N = -1. * N_1 * one

    if nlf == 6:
        # s = np.zeros((nep, 3))
        V = V_1 * one
        M = -M_1 * one + V_1 * xl
        s = np.column_stack((N, V, M))

    elif nlf == 1:
        # s = np.zeros((nep, 1))
        s = np.column_stack((N))

    for ele_load_data_i in ele_load_data:
        ele_load_type = ele_load_data_i[0]

        if ele_load_type == '-beamUniform':
            # raise ValueError
            # raise NameError

            n_ele_load_data = len(ele_load_data_i)

            if n_ele_load_data == 3:
                # eload_type, Wy, Wx = ele_load_data[0], ele_load_data[1], ele_load_data[2]
                Wy, Wx = ele_load_data_i[1], ele_load_data_i[2]

                N = -1.*(Wx * xl)

                if nlf == 6:
                    V = Wy * xl
                    M = 0.5 * Wy * xl**2
                    s += np.column_stack((N, V, M))
                elif nlf == 1:
                    s += np.column_stack((N))

            elif n_ele_load_data == 7:
                wta, waa, aL, bL, wtb, wab = ele_load_data_i[1:7]
                a, b = aL*L, bL*L

                bma = b - a

                indx = 0
                for x in np.nditer(xl):
                    xma = x - a
                    wtx = wta + (wtb - wta) * xma / bma
                    xc = xma * (wtx + 2*wta) / (3 * (wta + wtx))

                    Ax = 0.5 * (wtx+wta) * xma
                    Axxc = Ax * xc

                    if x < a:
                        pass
                    elif x >= a and x <= b:
                        s[indx, 0] += -1.*((wab - waa) * x)
                        s[indx, 1] += Ax
                        s[indx, 2] += Axxc

                    elif x > b:
                        xmb = x - b
                        xc = bma * (wtb + 2 * wta) / (3 * (wta + wtb)) + xmb
                        Ab = 0.5 * (wtb + wta) * bma
                        Abxc = Ab * xc

                        s[indx, 0] += -1. * ((wab - waa) * x)
                        s[indx, 1] += Ab
                        s[indx, 2] += Abxc

                    indx += 1

                if aL == 0 and bL == 0:
                    N = -1.*(N_1 * one + wta * xl)
                    V = V_1 * one + wta * xl
                else:
                    N = 0

        elif ele_load_type == '-beamPoint':
            Pt, aL, Pa = ele_load_data_i[1:4]
            a = aL * L

            indx = 0
            for x in np.nditer(xl):
                if x <= a:
                    pass
                    # s[indx, 0] += -1. * N_1
                    # s[indx, 1] += V_1
                    # s[indx, 2] += -M_1 + V_1 * x
                elif x > a:
                    s[indx, 0] += -1. * (Pa)
                    s[indx, 1] += Pt
                    s[indx, 2] += Pt * (x-a)

                indx += 1

    # if eload_type == '-beamUniform':
    # else:

    return s, xl, nep

def extract_section_force_data(ele_tag, sf_type, sfac=1/500, nep=2, dir_plt=0,):
    # https://portwooddigital.com/2022/11/04/simple-loads-on-a-cantilever/
    
    # Retrieve element tags from the analysis
    # ele_tags = ops.getEleTags()
    force_data = {}

    # for ele_tag in ele_tags:
        # Get node coordinates for the element
    try:
        ele_node_tags = ops.eleNodes(ele_tag)
        if not ele_node_tags or len(ele_node_tags) < 2:
            raise ValueError(f"Element {ele_tag} has invalid node tags: {ele_node_tags}")
        ecrd = np.array([ops.nodeCoord(tag) for tag in ele_node_tags])
    except Exception as e:
        raise Exception(f"Failed to get nodes/coordinates for element {ele_tag}: {e}")
    
    # Compute local coordinate system (xlocal, ylocal, zlocal)
    try:
        xloc = ops.eleResponse(ele_tag, 'xlocal')
        yloc = ops.eleResponse(ele_tag, 'ylocal')
        zloc = ops.eleResponse(ele_tag, 'zlocal')
        g = np.vstack((xloc, yloc, zloc))
    except Exception as e:
        raise Exception(f"Failed to get local coordinate system for element {ele_tag}: {e}")
    
    # If needed, adjust for offsets:
    try:
        ele_offsets = np.array(ops.eleResponse(ele_tag, 'offsets'))
        if np.any(ele_offsets):
            ecrd[:, 0] += ele_offsets[[0, 3]]
            ecrd[:, 1] += ele_offsets[[1, 4]]
            ecrd[:, 2] += ele_offsets[[2, 5]]
    except Exception as e:
        # Offsets are optional, continue if they fail
        pass
    
    # Get section force distribution data:
    try:
        pl = ops.eleResponse(ele_tag, 'localForces')
    except Exception as e:
        raise Exception(f"Failed to get local forces for element {ele_tag}: {e}")

    s_all, xl, nep = section_force_distribution_3d(ecrd, pl, nep, [['-beamUniform', 0., 0., 0.]])
  
    if sf_type == 'N':
        ss = s_all[:, 0]
        default_dir = 1
    elif sf_type == 'Vy':
        ss = s_all[:, 1]
        default_dir = 1
    elif sf_type == 'Vz':
        ss = s_all[:, 2]
        default_dir = 2
    elif sf_type == 'T':
        ss = s_all[:, 3]
        default_dir = 1
    elif sf_type == 'My':
        ss = s_all[:, 4]
        default_dir = 2
    elif sf_type == 'Mz':
        ss = s_all[:, 5]
        default_dir = 1
    else:
        raise ValueError("Invalid section force type.")
    
    if dir_plt == 0:
        dir_plt = default_dir

    # Compute the base positions s_0 along the beam in global coordinates
    s_0 = np.zeros((nep, 3))
    s_0[0, :] = ecrd[0, :]
    s_0[1:, 0] = s_0[0, 0] + xl[1:] * g[0, 0]
    s_0[1:, 1] = s_0[0, 1] + xl[1:] * g[0, 1]
    s_0[1:, 2] = s_0[0, 2] + xl[1:] * g[0, 2]
    
    # print('s_0: ', s_0)
    # Scale the force values
    # print('SS: ', ss)
    s_scaled = ss * sfac

    if sf_type == 'Mz':  # Adjust sign if necessary
        s_scaled *= -1
    
    # Compute the displaced positions s_p (offset by the scaled force in the chosen direction)
    s_p = np.copy(s_0)
    s_p[:, 0] += s_scaled * g[dir_plt, 0]
    s_p[:, 1] += s_scaled * g[dir_plt, 1]
    s_p[:, 2] += s_scaled * g[dir_plt, 2]
    
    # Determine min and max force values
    minVal = np.amin(ss)
    maxVal = np.amax(ss)
    # print('s_p: ', s_p)
    # Save the data for the current element
    force_data = {
        "base_positions": s_0.tolist(),
        "displaced_positions": s_p.tolist(),
        # "evaluation_points": xl,
        "force_values": (ss / 1E3).tolist(),
        # "min_value": minVal,
        # "max_value": maxVal
    }
      
    return force_data
