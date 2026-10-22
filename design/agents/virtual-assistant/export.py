"""Bake and export the Virtual Assistant with its independent humanoid rig."""
from pathlib import Path
import runpy
HERE=Path(__file__).resolve().parent
runpy.run_path(str(HERE.parent/'social-media/export.py'),init_globals={
 'ASSET_DIR':HERE,'ASSET_ID':'virtual-assistant','RIG_NAME':'VirtualAssistantRig',
 'BODY_COLLECTION':'Virtual Assistant — editable parts',
 'PROP_COLLECTION':'Assistant — removable tablet','PROP_SUFFIX':'tablet'})
