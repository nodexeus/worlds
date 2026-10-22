"""Use the validated campus bake and portable skin export for the courier."""
from pathlib import Path
import runpy
HERE=Path(__file__).resolve().parent
runpy.run_path(str(HERE.parent/'social-media/export.py'),init_globals={
 'ASSET_DIR':HERE,'ASSET_ID':'email-marketing','RIG_NAME':'EmailMarketingRig',
 'BODY_COLLECTION':'Email Marketing — editable parts',
 'PROP_COLLECTION':'Mail — removable accessories','PROP_SUFFIX':'mail'})
