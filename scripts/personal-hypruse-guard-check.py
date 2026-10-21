"""Check the installed launcher blocks focus before any desktop operation."""
import importlib.util
import json
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
os.environ['HYPRUSE_BACKGROUND'] = '0'
spec = importlib.util.spec_from_file_location('openbot_hypruse', root / 'resources/hypruse/openbot-hypruse.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert os.environ['HYPRUSE_BACKGROUND'] == '1'
try:
    module.a11y.grab_focus(None, 'unused', 'unused')
except module.background.trust.TrustError as error:
    assert 'OpenBot blocks accessibility focus' in str(error)
else:
    raise AssertionError('The unsafe focus route was not blocked')
out = root / '.openbot-build/hypruse-openbot'
out.mkdir(parents=True, exist_ok=True)
(out / 'guard-report.json').write_text(json.dumps({'passed': True, 'foregroundOverrideIgnored': True, 'accessibilityFocusBlocked': True}))
print('PASS ' + str(out / 'guard-report.json'))
