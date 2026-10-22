"""OpenBot's background-only launcher for the pinned Hypruse backend."""
import os
from importlib.metadata import version

if version('hypruse') != '0.13.0':
    raise SystemExit('OpenBot requires hypruse==0.13.0. Reinstall the pinned backend.')

os.environ['HYPRUSE_BACKGROUND'] = '1'
os.environ.setdefault('HYPRUSE_AGENT_WORKSPACES', '29,28,27')
os.environ.pop('HYPRUSE_JOURNAL_TEXT', None)

from hypruse import a11y, background, server, trust


def allow_workspace(name, instead=''):
    pass


# Background delivery and workspace confinement are separate choices in OpenBot.
trust._confine_scope = trust._explicit_scope
background.require_agent_workspace = allow_workspace
server.BACKGROUND_GUARANTEE = """
Background-only input is enabled. You may target a requested window on any
workspace, including existing windows outside the default launch workspaces.
The workspace list ({workspaces}) is only a preference for placing new apps.
Use keyboard with window= and semantic click_ui actions without changing
the human's focus or workspace. Pointer actions, focus/workspace switches,
and background=false remain refused. Stop on an action WARNING or refusal.
Do not focus text fields through accessibility; OpenBot blocks that route.
New apps must launch out of the human's sight; existing windows stay in place.
"""


def refuse_focus(*args, **kwargs):
    background.refuse(
        'OpenBot blocks accessibility focus because it activated the human workspace in testing',
        'use keyboard with window= directly for a single editable field, or stop',
    )


original_action = a11y.do_action


def background_action(bus, service, path):
    if 'focus' in a11y.action_name(bus, service, path).lower():
        refuse_focus()
    return original_action(bus, service, path)


a11y.grab_focus = refuse_focus
a11y.do_action = background_action

if __name__ == '__main__':
    server.main()
