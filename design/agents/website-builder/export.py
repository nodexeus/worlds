"""Bake and export the Website Builder's independent wheeled rig."""
from pathlib import Path
import runpy
HERE=Path(__file__).resolve().parent
runpy.run_path(str(HERE.parent/'social-media/export.py'),init_globals={
 'ASSET_DIR':HERE,'ASSET_ID':'website-builder','RIG_NAME':'WebsiteBuilderRig',
 'BODY_COLLECTION':'Website Builder — editable parts',
 'PROP_COLLECTION':'Builder — removable tablet and plans','PROP_SUFFIX':'tools',
 'LIGHT_UV_SCALE':{1:12}})
