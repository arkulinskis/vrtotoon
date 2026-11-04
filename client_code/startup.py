"""The app starts here (anvil.yaml: startup module). One server call to learn who is signed in (Anvil's loading
spinner shows meanwhile), the Privacy & Terms kit, then the page for the address in the browser bar."""
import anvil.server

from . import vt

from . import legal, router, state

LEGAL_THEME = {"accent": "#b3182b"}  # colours for the Privacy & Terms page (match --c-brand in app.css)

legal.setup(LEGAL_THEME)
vt.set_api(anvil.server.get_api_origin())  # recordings are served from /_/api/m/<key>
state.set_me(anvil.server.call("get_me"))
if state.me():
    legal.refresh_soon()
router.start()
