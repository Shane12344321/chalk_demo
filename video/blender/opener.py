"""CHALK cold-open: the wordmark is drawn in chalk on a dark slate board,
then lifts into solid letters while dust drifts through a light beam.

Run: Blender -b -P video/blender/opener.py -- <out_dir> [--preview]
"""

import math
import random
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "/tmp/chalk_opener/"
PREVIEW = "--preview" in argv
FPS = 30
FRAMES = 210  # 7 s

random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, FRAMES
scene.render.fps = FPS
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.render.resolution_percentage = 50 if PREVIEW else 100
scene.render.engine = "BLENDER_EEVEE"
ee = scene.eevee
ee.taa_render_samples = 16 if PREVIEW else 64
for attr, val in (("use_raytracing", True), ("use_shadows", True), ("volumetric_tile_size", "4"),
                  ("volumetric_samples", 96), ("use_volumetric_shadows", True),
                  ("volumetric_end", 40.0)):
    if hasattr(ee, attr):
        try:
            setattr(ee, attr, val)
        except Exception:
            pass
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = OUT.rstrip("/") + "/f_"

world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.004, 0.006, 0.006, 1)
bg.inputs[1].default_value = 1.0
# volumetric haze for the light beam
vol = world.node_tree.nodes.new("ShaderNodeVolumePrincipled")
vol.inputs["Density"].default_value = 0.018
world.node_tree.links.new(vol.outputs[0], world.node_tree.nodes["World Output"].inputs["Volume"])


def mat(name, build):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    build(nt, nt.nodes["Principled BSDF"])
    return m


def slate(nt, p):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 3.5
    n.inputs["Detail"].default_value = 12
    n.inputs["Roughness"].default_value = 0.62
    smudge = nt.nodes.new("ShaderNodeTexNoise")
    smudge.inputs["Scale"].default_value = 0.6
    smudge.inputs["Detail"].default_value = 4
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.006, 0.012, 0.010, 1)
    ramp.color_ramp.elements[1].color = (0.026, 0.040, 0.035, 1)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["Factor"].default_value = 0.35
    nt.links.new(n.outputs["Fac"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], mix.inputs[6])
    nt.links.new(smudge.outputs["Color"], mix.inputs[7])
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.inputs["Factor"].default_value = 0.82
    nt.links.new(mix.outputs[2], tint.inputs[6])
    tint.inputs[7].default_value = (0.010, 0.020, 0.017, 1)
    nt.links.new(tint.outputs[2], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.88
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], p.inputs["Normal"])


def chalk(nt, p):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 140
    n.inputs["Detail"].default_value = 6
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.38
    ramp.color_ramp.elements[0].color = (0.55, 0.56, 0.53, 1)
    ramp.color_ramp.elements[1].color = (0.96, 0.95, 0.90, 1)
    nt.links.new(n.outputs["Fac"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.95
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], p.inputs["Normal"])
    p.inputs["Emission Color"].default_value = (1.0, 0.97, 0.9, 1)
    p.inputs["Emission Strength"].default_value = 0.05


def ember(nt, p):
    p.inputs["Base Color"].default_value = (0.84, 0.36, 0.12, 1)
    p.inputs["Emission Color"].default_value = (1.0, 0.45, 0.15, 1)
    p.inputs["Emission Strength"].default_value = 6.0


def dust(nt, p):
    p.inputs["Base Color"].default_value = (1, 0.97, 0.92, 1)
    p.inputs["Emission Color"].default_value = (1, 0.93, 0.82, 1)
    p.inputs["Emission Strength"].default_value = 2.5


M_SLATE = mat("Slate", slate)
M_CHALK = mat("Chalk", chalk)
M_EMBER = mat("Ember", ember)
M_DUST = mat("Dust", dust)

# --- board -------------------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
board = bpy.context.object
board.scale = (26, 15, 1)
board.data.materials.append(M_SLATE)

# faint grid ruled into the slate, like the app's board
grid_lines = []
for i in range(-12, 13):
    for horiz in (True, False):
        if horiz and abs(i) > 7:
            continue
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0, i, 0.002) if horiz else (i, 0, 0.002))
        g = bpy.context.object
        g.scale = (26, 0.012, 1) if horiz else (0.012, 15, 1)
        grid_lines.append(g)
M_GRID = mat("Grid", lambda nt, p: (
    p.inputs["Base Color"].__setattr__("default_value", (0.05, 0.078, 0.068, 1)),
    p.inputs["Roughness"].__setattr__("default_value", 1.0)))
for g in grid_lines:
    g.data.materials.append(M_GRID)

# --- wordmark ------------------------------------------------------------
font_path = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"
try:
    font = bpy.data.fonts.load(font_path)
except Exception:
    font = None


def make_text(body, size, loc):
    bpy.ops.object.text_add(location=loc)
    t = bpy.context.object
    t.data.body = body
    if font:
        t.data.font = font
    t.data.size = size
    t.data.align_x = "CENTER"
    t.data.align_y = "CENTER"
    t.data.space_character = 1.06
    return t


# outline pass: text -> curve outline with a chalk-thick bevel that "draws on"
outline = make_text("CHALK", 3.2, (0, 0.35, 0.02))
bpy.ops.object.convert(target="CURVE")
outline.data.dimensions = "3D"
outline.data.materials.append(M_CHALK)
# Geometry Nodes: trim each letter contour to an animated factor, then sweep a
# chalk-thick profile along it so the outline is drawn on like a stroke.
gn = bpy.data.node_groups.new("ChalkDraw", "GeometryNodeTree")
gn.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
gn.interface.new_socket("Factor", in_out="INPUT", socket_type="NodeSocketFloat")
gn.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
gi = gn.nodes.new("NodeGroupInput")
go = gn.nodes.new("NodeGroupOutput")
trim = gn.nodes.new("GeometryNodeTrimCurve")
prof = gn.nodes.new("GeometryNodeCurvePrimitiveCircle")
prof.inputs["Radius"].default_value = 0.034
prof.inputs["Resolution"].default_value = 8
c2m = gn.nodes.new("GeometryNodeCurveToMesh")
setm = gn.nodes.new("GeometryNodeSetMaterial")
setm.inputs["Material"].default_value = M_CHALK
L = gn.links.new
L(gi.outputs[0], trim.inputs["Curve"])
end_sock = [i for i in trim.inputs if i.name == "End" and i.type == "VALUE"][0]
L(gi.outputs[1], end_sock)
L(trim.outputs[0], c2m.inputs["Curve"])
L(prof.outputs[0], c2m.inputs["Profile Curve"])
if "Fill Caps" in c2m.inputs:
    c2m.inputs["Fill Caps"].default_value = True
L(c2m.outputs[0], setm.inputs["Geometry"])
L(setm.outputs[0], go.inputs[0])
mod = outline.modifiers.new("ChalkDraw", "NODES")
mod.node_group = gn
fac_id = gn.interface.items_tree["Factor"].identifier
fac = getattr(mod.properties.inputs, fac_id)
fac.value = 0.0
fac.keyframe_insert("value", frame=12)
fac.value = 1.0
fac.keyframe_insert("value", frame=78)

# solid pass: extruded letters rise out of the board after the outline completes
solid = make_text("CHALK", 3.2, (0, 0.35, -0.5))
solid.data.extrude = 0.22
solid.data.bevel_depth = 0.02
solid.data.bevel_resolution = 3
solid.data.materials.append(M_CHALK)
solid.keyframe_insert("location", frame=70)
solid.location.z = 0.24
solid.keyframe_insert("location", frame=104)

# ember underline: the accent stroke from the app
bpy.ops.curve.primitive_bezier_curve_add(location=(0, -1.25, 0.03))
under = bpy.context.object
sp = under.data.splines[0]
pts = sp.bezier_points
pts[0].co = Vector((-4.6, 0.05, 0))
pts[0].handle_left = Vector((-5.0, 0.1, 0))
pts[0].handle_right = Vector((-2.0, -0.25, 0))
pts[1].co = Vector((4.6, -0.05, 0))
pts[1].handle_left = Vector((2.0, 0.22, 0))
pts[1].handle_right = Vector((5.0, -0.1, 0))
under.data.bevel_depth = 0.05
under.data.use_fill_caps = True
under.data.materials.append(M_EMBER)
under.data.bevel_factor_end = 0
under.data.keyframe_insert("bevel_factor_end", frame=96)
under.data.bevel_factor_end = 1
under.data.keyframe_insert("bevel_factor_end", frame=124)

# --- dust ----------------------------------------------------------------
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.012, location=(0, 0, -50))
mote = bpy.context.object
mote.data.materials.append(M_DUST)
for i in range(220 if not PREVIEW else 80):
    d = mote.copy()
    d.data = mote.data
    bpy.context.collection.objects.link(d)
    x, y, z = random.uniform(-9, 9), random.uniform(-5, 5), random.uniform(0.3, 6)
    s = random.uniform(0.4, 1.8)
    d.scale = (s, s, s)
    drift = Vector((random.uniform(-0.6, 0.6), random.uniform(0.2, 1.2), random.uniform(-0.3, 0.5)))
    d.location = (x, y, z)
    d.keyframe_insert("location", frame=1)
    d.location = Vector((x, y, z)) + drift
    d.keyframe_insert("location", frame=FRAMES)

# faded chalk working in the background, thrown out of focus by the lens
M_FAINT = mat("FaintChalk", lambda nt, p: (
    p.inputs["Base Color"].__setattr__("default_value", (0.34, 0.37, 0.35, 1)),
    p.inputs["Roughness"].__setattr__("default_value", 1.0)))
try:
    scrawl_font = bpy.data.fonts.load("/System/Library/Fonts/Supplemental/Chalkduster.ttf")
except Exception:
    scrawl_font = font
for body, size, loc, rot in (
    ("R = v^2/g sin 2t", 1.1, (-6.2, 4.2), 4), ("F = ma", 1.2, (6.4, 4.4), -6),
    ("a^2 + b^2 = c^2", 1.0, (-7.0, -4.3), -3), ("dy/dx", 1.1, (6.8, -4.0), 5),
    ("y = sin x", 1.0, (0.4, 5.6), 2), ("E = 1/2 mv^2", 0.95, (-1.5, -5.4), -2),
    ("45", 1.2, (9.8, 0.6), 8), ("pi/4", 0.9, (-10.0, 1.0), -7)):
    t = make_text(body, size, (loc[0], loc[1], 0.004))
    if scrawl_font:
        t.data.font = scrawl_font
    t.rotation_euler.z = math.radians(rot)
    t.data.materials.append(M_FAINT)
# --- lights --------------------------------------------------------------
bpy.ops.object.light_add(type="SPOT", location=(-7, -6, 11))
key = bpy.context.object
key.data.energy = 9000
key.data.color = (1.0, 0.86, 0.68)
key.data.spot_size = math.radians(48)
key.data.spot_blend = 0.6
key.data.shadow_soft_size = 0.6
key.rotation_euler = (math.radians(42), 0, math.radians(-38))
key.data.energy = 2500
key.data.keyframe_insert("energy", frame=1)
key.data.energy = 9000
key.data.keyframe_insert("energy", frame=40)

bpy.ops.object.light_add(type="AREA", location=(6, 5, 7))
rim = bpy.context.object
rim.data.energy = 900
rim.data.size = 6
rim.data.color = (0.55, 0.75, 1.0)
rim.rotation_euler = (math.radians(-35), math.radians(30), 0)

bpy.ops.object.light_add(type="POINT", location=(0, -1.25, 0.6))
glow = bpy.context.object
glow.data.color = (1.0, 0.5, 0.2)
glow.data.energy = 0
glow.data.keyframe_insert("energy", frame=100)
glow.data.energy = 120
glow.data.keyframe_insert("energy", frame=130)

# --- camera --------------------------------------------------------------
bpy.ops.object.camera_add(location=(-3.4, -13.5, 6.4))
cam = bpy.context.object
scene.camera = cam
cam.data.lens = 36
cam.data.dof.use_dof = True
cam.data.dof.aperture_fstop = 2.0
bpy.ops.object.empty_add(location=(0, 0.1, 0.2))
target = bpy.context.object
con = cam.constraints.new("TRACK_TO")
con.target = target
con.track_axis = "TRACK_NEGATIVE_Z"
con.up_axis = "UP_Y"
cam.data.dof.focus_object = target
cam.keyframe_insert("location", frame=1)
cam.location = (0.0, -11.6, 8.6)
cam.keyframe_insert("location", frame=FRAMES)
for fc in (cam.animation_data.action.fcurves if hasattr(cam.animation_data.action, "fcurves") else []):
    for kp in fc.keyframe_points:
        kp.interpolation = "SINE"

if "--frames" in argv:
    for f in argv[argv.index("--frames") + 1:]:
        scene.frame_set(int(f))
        scene.render.filepath = OUT.rstrip("/") + f"/still_{int(f):04d}.png"
        bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
