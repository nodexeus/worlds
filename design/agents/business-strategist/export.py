"""Export baked machinery and props alongside the transparent skinned globe."""
from pathlib import Path
import runpy
import bpy
HERE=Path(__file__).resolve().parent
bpy.data.objects['StrategistGlobe'].data.name='StrategistGlobe'
runpy.run_path(str(HERE.parent/'social-media/export.py'),init_globals={
 'ASSET_DIR':HERE,'ASSET_ID':'business-strategist','RIG_NAME':'BusinessStrategistRig',
 'BODY_COLLECTION':'Business Strategist — editable parts',
 'PROP_COLLECTION':'Strategy — removable tablet and charts','PROP_SUFFIX':'tablet',
 'EXTRA_EXPORT_OBJECTS':['StrategistGlobe']})
