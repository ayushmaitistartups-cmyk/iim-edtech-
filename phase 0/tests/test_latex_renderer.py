"""Smoke tests for the matplotlib mathtext → RGB565 pipeline."""

import struct

import pytest

from app.providers import latex_renderer


def test_simple_expression_renders_to_320x240_rgb565():
    rendered = latex_renderer.render(r"\frac{1}{2} + x^2")
    assert rendered is not None
    assert rendered.width == latex_renderer.RENDER_W
    assert rendered.height == latex_renderer.RENDER_H
    assert rendered.n_frames >= 1
    expected_bytes = rendered.width * rendered.height * 2 * rendered.n_frames
    assert len(rendered.pixels) == expected_bytes


def test_wire_payload_header_packs_dimensions_and_count():
    rendered = latex_renderer.render(r"\sqrt{x}")
    assert rendered is not None
    wire = rendered.to_wire_payload()
    w, h, n, _ = struct.unpack(">HHBB", wire[:6])
    assert w == latex_renderer.RENDER_W
    assert h == latex_renderer.RENDER_H
    assert n == rendered.n_frames
    assert len(wire) == 6 + len(rendered.pixels)


def test_unparseable_latex_returns_none_so_caller_falls_back_to_text():
    # \boxed is part of amsmath, NOT mathtext — should fail cleanly.
    out = latex_renderer.render(r"\boxed{x = 5}")
    # Either the renderer crashes (returns None) or matplotlib accepts it on
    # newer versions; both are valid as long as we don't raise to the caller.
    assert out is None or out.width == latex_renderer.RENDER_W


def test_empty_string_returns_none():
    assert latex_renderer.render("") is None


def test_aliases_are_rewritten_before_mathtext():
    # \integral is a custom alias defined in latex_renderer.ALIASES.
    rendered = latex_renderer.render(r"\integral x \, dx")
    assert rendered is not None
    assert rendered.width == latex_renderer.RENDER_W


def test_selftest_runs():
    # Must not raise — boot-time sanity check.
    latex_renderer.selftest()
