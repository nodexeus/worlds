"""Bake the Copywriter, preserving rigid machinery and blended scarf weights."""
from pathlib import Path
import runpy
HERE=Path(__file__).resolve().parent
cloth=runpy.run_path(str(HERE/'cloth.py'))
runpy.run_path(str(HERE.parent/'social-media/export.py'),init_globals={
 'ASSET_DIR':HERE,'ASSET_ID':'copywriter','RIG_NAME':'CopywriterRig',
 'BODY_COLLECTION':'Copywriter — editable parts',
 'PROP_COLLECTION':'Writing — removable accessories','PROP_SUFFIX':'writing',
 'POST_SKIN':cloth['weight_scarf']})
