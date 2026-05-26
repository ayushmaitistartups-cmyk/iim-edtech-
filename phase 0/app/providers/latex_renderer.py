"""Render LaTeX → RGB565 BE pixels for the lamp's TFT.

The lamp's TFT (ILI9341, 240×320 portrait → 320×240 landscape) ingests a
pre-rendered pixel buffer in RGB565 big-endian byte-swapped BGR. We hand
the LLM's ``display.content`` string to matplotlib's ``mathtext`` engine
(a *subset* of LaTeX — see ``BACKEND_DESIGN.md §4.6.1``) and convert the
rasterized RGB image to that wire format.

Failure mode: if mathtext throws, we return ``None`` and let the
orchestrator fall back to ``TFT_TEXT``.

The payload header (4 bytes: width-be16, height-be16, n_frames-u8, reserved-u8)
prefixes the pixel buffer per ``IMPLEMENTATION_WEBSOCKET.md``.
"""

from __future__ import annotations

import logging
import struct
from dataclasses import dataclass
from typing import Optional


logger = logging.getLogger(__name__)

# Lamp panel in landscape orientation.
RENDER_W = 320
RENDER_H = 240

# Render the equation at ~20% of the short axis (~48 px tall), giving the
# matplotlib autoscaler room to keep glyphs crisp.
EQUATION_PX_HEIGHT = max(40, int(RENDER_H * 0.20))


# Aliases the prompt forbids but defensive callers may still emit; rewritten
# before handing to mathtext. Matches BACKEND_DESIGN §4.6.1.
#
# Important: replacement uses regex with a trailing word-boundary so that
# ``\inf`` does NOT chew the prefix of ``\infty``. Same applies for any
# alias that's a prefix of a real mathtext token.
ALIASES: dict[str, str] = {
    r"\integral": r"\int",
    r"\derivative": r"\frac{d}{dx}",
    r"\inf": r"\infty",
    r"\oo": r"\infty",
    r"\cross": r"\times",
    r"\dot_product": r"\cdot",
}


def _strip_delimiters(s: str) -> str:
    s = s.strip()
    if s.startswith("$$") and s.endswith("$$"):
        s = s[2:-2]
    elif s.startswith("$") and s.endswith("$"):
        s = s[1:-1]
    return s.strip()


def _normalise_latex(s: str) -> str:
    import re

    s = _strip_delimiters(s)
    for alias, replacement in ALIASES.items():
        # Match the alias only when the next character is NOT a letter — that
        # way ``\inf`` rewrites ``\inf{}`` but leaves ``\infty`` alone. Use a
        # callable replacement so backslashes inside ``replacement`` (e.g.
        # ``\int``) aren't reinterpreted as regex backreferences.
        pattern = re.escape(alias) + r"(?![A-Za-z])"
        s = re.sub(pattern, lambda _m, _r=replacement: _r, s)
    s = s.replace(r"\limits", "")
    return s


@dataclass(frozen=True)
class RenderedFrame:
    width: int
    height: int
    n_frames: int
    pixels: bytes      # raw RGB565 BE bytes, length = width * height * 2 * n_frames

    def to_wire_payload(self) -> bytes:
        header = struct.pack(">HHBB", self.width, self.height, self.n_frames, 0)
        return header + self.pixels


def _rgb_to_rgb565_be(rgb_array) -> bytes:
    """Convert an ndarray of shape ``(H, W, 3)`` uint8 → packed RGB565 BE bytes.

    Matches the lamp's expected byte order:
      * RGB → RGB565 numerically
      * Big-endian byte swap on the wire (so the lamp can ``memcpy`` straight
        into the ILI9341 frame buffer).
    """
    import numpy as np

    r = rgb_array[..., 0].astype(np.uint16).ravel()
    g = rgb_array[..., 1].astype(np.uint16).ravel()
    b = rgb_array[..., 2].astype(np.uint16).ravel()
    rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
    # Big-endian byte swap (high byte first).
    out = np.empty(rgb565.size * 2, dtype=np.uint8)
    out[0::2] = ((rgb565 >> 8) & 0xFF).astype(np.uint8)
    out[1::2] = (rgb565 & 0xFF).astype(np.uint8)
    return out.tobytes()


def _render_mathtext_to_rgb(latex: str, target_h_px: int = EQUATION_PX_HEIGHT):
    """Rasterise a mathtext expression to a tight (H, W, 3) RGB array
    (black background, white foreground). Raises matplotlib's parse error
    on unsupported syntax.
    """
    import io

    import matplotlib
    matplotlib.use("Agg")  # type: ignore[arg-type]
    import matplotlib.pyplot as plt
    import numpy as np
    from matplotlib.figure import Figure
    from PIL import Image

    plt.rcParams["mathtext.fontset"] = "stix"
    plt.rcParams["text.color"] = "white"
    plt.rcParams["axes.facecolor"] = "black"
    plt.rcParams["figure.facecolor"] = "black"

    fig = Figure(figsize=(8, 1.5), dpi=100, facecolor="black")
    ax = fig.add_subplot(111)
    ax.set_axis_off()
    ax.set_facecolor("black")
    ax.text(
        0.0,
        0.5,
        f"${latex}$",
        color="white",
        ha="left",
        va="center",
        fontsize=22,
        transform=ax.transAxes,
    )

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0.05, facecolor="black")
    buf.seek(0)
    img = Image.open(buf).convert("RGB")
    # Scale so the height matches target_h_px while preserving aspect ratio.
    w, h = img.size
    scale = target_h_px / max(1, h)
    new_w = max(1, int(round(w * scale)))
    img = img.resize((new_w, target_h_px), Image.LANCZOS)
    return np.array(img)


def render(latex: str) -> Optional[RenderedFrame]:
    """Render a single-frame TFT image. Returns ``None`` on any failure
    (caller should fall back to ``TFT_TEXT``)."""

    try:
        normalised = _normalise_latex(latex)
        if not normalised:
            return None

        rgb = _render_mathtext_to_rgb(normalised)
        eq_h, eq_w = rgb.shape[:2]

        # If the equation is wider than the screen, generate a scroll
        # animation of overlapping frames. The lamp pages through them
        # with its LEFT/RIGHT buttons.
        n_frames = 1
        frames_rgb = [rgb]
        if eq_w > RENDER_W:
            import numpy as np

            stride = RENDER_W // 2
            n_frames = max(1, (eq_w - RENDER_W + stride - 1) // stride + 1)
            n_frames = min(n_frames, 24)
            frames_rgb = []
            for i in range(n_frames):
                x0 = min(i * stride, eq_w - RENDER_W)
                frames_rgb.append(rgb[:, x0 : x0 + RENDER_W])

        # Pad each frame to the full 320×240 canvas (black background, eq centred vertically).
        import numpy as np

        canvases: list[bytes] = []
        for frame in frames_rgb:
            f_h, f_w = frame.shape[:2]
            canvas = np.zeros((RENDER_H, RENDER_W, 3), dtype=np.uint8)
            y0 = max(0, (RENDER_H - f_h) // 2)
            x_canvas = max(0, (RENDER_W - f_w) // 2) if f_w < RENDER_W else 0
            place = frame if f_w <= RENDER_W else frame[:, :RENDER_W]
            place_w = place.shape[1]
            place_h = place.shape[0]
            canvas[y0 : y0 + place_h, x_canvas : x_canvas + place_w] = place
            canvases.append(_rgb_to_rgb565_be(canvas))

        return RenderedFrame(
            width=RENDER_W,
            height=RENDER_H,
            n_frames=len(canvases),
            pixels=b"".join(canvases),
        )

    except Exception as exc:
        logger.warning("LaTeX render failed for %r: %s", latex[:60], exc)
        return None


def selftest() -> None:
    """Pre-render a representative expression at boot so we fail loudly if
    matplotlib's mathtext drifts. Reference: ``BACKEND_DESIGN.md §4.6.1``."""
    sample = r"\int_0^\infty e^{-x^2}\,dx = \frac{1}{2}\sqrt{\pi}"
    rendered = render(sample)
    if rendered is None or len(rendered.pixels) == 0:
        raise RuntimeError("LaTeX renderer self-test produced no pixels")
