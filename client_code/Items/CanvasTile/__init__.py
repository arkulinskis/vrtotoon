import anvil.js
from anvil import *

from ._anvil_designer import CanvasTileTemplate


class CanvasTile(CanvasTileTemplate):
    """One canvas in a CanvasPicker: its shape drawn to scale, name and ratio. item = {id, name, label, use, r, on, off (disabled)}.
    Click: x-canvas on the RepeatingPanel with the canvas id."""

    def __init__(self, **properties):
        super().__init__(**properties)
        it = self.item
        btn, shape = self.dom_nodes["btn"], self.dom_nodes["shape"]
        self.dom_nodes["name"].textContent = it.get("name") or ""
        self.dom_nodes["ratio"].textContent = it.get("id") or ""
        shape.style.setProperty("--r", str(it.get("r") or 1.7778))
        btn.setAttribute("aria-pressed", "true" if it.get("on") else "false")
        btn.setAttribute("title", "%s: %s" % (it.get("label") or "", it.get("use") or ""))
        if it.get("on"):
            btn.classList.add("on")
        if it.get("off"):
            btn.setAttribute("disabled", "")
        btn.addEventListener("click", anvil.js.report_exceptions(self._click))

    def _click(self, *args):
        self.parent.raise_event("x-canvas", aspect_id=self.item.get("id"))
