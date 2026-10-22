"""Bake the scout's rigid model, removable magnifier, and 18 action clips, including authored flight."""
from pathlib import Path
import runpy
HERE=Path(__file__).resolve().parent
runpy.run_path(str(HERE.parent/'social-media/export.py'),init_globals={
 'ASSET_DIR':HERE,'ASSET_ID':'seo-strategist','RIG_NAME':'SEOStrategistRig',
 'BODY_COLLECTION':'SEO Strategist — editable parts',
 'PROP_COLLECTION':'Search — removable magnifier','PROP_SUFFIX':'magnifier'})
