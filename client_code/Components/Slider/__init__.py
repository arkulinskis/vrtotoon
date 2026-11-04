import anvil.js
from anvil import *
from anvil.js import window

from ._anvil_designer import SliderTemplate


class Slider(SliderTemplate):
    """A labelled range slider. change(value, final): final is False while dragging (live preview) and True when the
    slider is let go (the moment to remember for undo)."""

    def __init__(self, **properties):
        self._label = ""
        self._value = 1.0
        self._min = 0.0
        self._max = 2.0
        self._step = 0.01
        self._fmt = "pct"
        self._ready = False
        super().__init__(**properties)
        self._ready = True
        inp = self.dom_nodes["input"]
        inp.addEventListener("input", anvil.js.report_exceptions(self._on_input))
        inp.addEventListener("change", anvil.js.report_exceptions(self._on_change))
        self._sync()

    def _show(self, v):
        if self._fmt == "signed":
            return "%+.1f" % v
        if self._fmt == "plain":
            return "%.2f" % v
        return "%d%%" % int(round(v * 100))

    def _sync(self):
        if not self._ready:
            return
        inp = self.dom_nodes["input"]
        inp.setAttribute("min", str(self._min))
        inp.setAttribute("max", str(self._max))
        inp.setAttribute("step", str(self._step))
        inp.setAttribute("aria-label", self._label)
        window.Object.assign(inp, {"value": str(self._value)})
        self.label_label.text = self._label
        self.value_label.text = self._show(self._value)

    def _read(self):
        try:
            return float(getattr(self.dom_nodes["input"], "value"))
        except Exception:
            return self._value

    def _on_input(self, event=None):
        self._value = self._read()
        self.value_label.text = self._show(self._value)
        self.raise_event("change", value=self._value, final=False)

    def _on_change(self, event=None):
        self._value = self._read()
        self.value_label.text = self._show(self._value)
        self.raise_event("change", value=self._value, final=True)

    @property
    def label(self):
        return self._label

    @label.setter
    def label(self, v):
        self._label = v or ""
        self._sync()

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        self._value = float(v if v is not None else 1)
        self._sync()

    @property
    def min_value(self):
        return self._min

    @min_value.setter
    def min_value(self, v):
        self._min = float(v or 0)
        self._sync()

    @property
    def max_value(self):
        return self._max

    @max_value.setter
    def max_value(self, v):
        self._max = float(v if v is not None else 2)
        self._sync()

    @property
    def step(self):
        return self._step

    @step.setter
    def step(self, v):
        self._step = float(v or 0.01)
        self._sync()

    @property
    def fmt(self):
        return self._fmt

    @fmt.setter
    def fmt(self, v):
        self._fmt = v or "pct"
        self._sync()
