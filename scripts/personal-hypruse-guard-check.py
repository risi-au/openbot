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
os.environ.pop('HYPRUSE_CONFINE', None)
module.trust.guard_client({'address': 'test-only', 'class': 'scratch', 'workspace': {'id': 50, 'name': '50'}})
module.background.require_agent_workspace('50')
os.environ['HYPRUSE_CONFINE'] = 'workspace:2'
try:
    module.trust.guard_client({'address': 'test-only', 'class': 'scratch', 'workspace': {'id': 50, 'name': '50'}})
except module.trust.TrustError:
    pass
else:
    raise AssertionError('Explicit user confinement was lost')
os.environ.pop('HYPRUSE_CONFINE')
try:
    module.background.decide(False, False)
except module.trust.TrustError:
    pass
else:
    raise AssertionError('Foreground input was allowed')
try:
    module.a11y.grab_focus(None, 'unused', 'unused')
except module.background.trust.TrustError as error:
    assert 'OpenBot blocks accessibility focus' in str(error)
else:
    raise AssertionError('The unsafe focus route was not blocked')
out = root / '.openbot-build/hypruse-openbot'
out.mkdir(parents=True, exist_ok=True)
(out / 'guard-report.json').write_text(json.dumps({'passed': True, 'anyWorkspaceAllowed': True, 'explicitConfinementPreserved': True, 'foregroundRefused': True, 'accessibilityFocusBlocked': True}))
print('PASS ' + str(out / 'guard-report.json'))
