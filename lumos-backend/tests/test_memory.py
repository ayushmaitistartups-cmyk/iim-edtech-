"""Phase 2 short-term memory: LPUSH + LTRIM + EXPIRE round-trip + prompt rendering."""

import pytest

from app.services import memory
from app.storage import redis_client


@pytest.fixture(autouse=True)
def _fresh_memory_redis():
    """Each test gets a clean in-process Redis."""
    redis_client.reset_for_testing()
    yield
    redis_client.reset_for_testing()


@pytest.mark.asyncio
async def test_record_then_retrieve_returns_newest_first():
    await memory.record_turn("dev-lamp", "First answer", "text")
    await memory.record_turn("dev-lamp", "Second answer", "latex")
    await memory.record_turn("dev-lamp", "Third answer", "none")

    turns = await memory.get_recent_turns("dev-lamp")
    assert [t.speech for t in turns] == ["Third answer", "Second answer", "First answer"]
    assert turns[0].display_kind == "none"
    assert turns[1].display_kind == "latex"


@pytest.mark.asyncio
async def test_history_is_capped_at_three_turns():
    for i in range(6):
        await memory.record_turn("dev-lamp", f"Answer {i}", "text")
    turns = await memory.get_recent_turns("dev-lamp")
    assert len(turns) == memory.HISTORY_KEEP
    # Newest first — we just pushed 5,4,3,2,1,0 in that order; keep 5,4,3.
    assert [t.speech for t in turns] == ["Answer 5", "Answer 4", "Answer 3"]


@pytest.mark.asyncio
async def test_history_is_namespaced_per_device():
    await memory.record_turn("dev-lamp-A", "Alpha answer", "text")
    await memory.record_turn("dev-lamp-B", "Beta answer", "latex")
    a = await memory.get_recent_turns("dev-lamp-A")
    b = await memory.get_recent_turns("dev-lamp-B")
    assert [t.speech for t in a] == ["Alpha answer"]
    assert [t.speech for t in b] == ["Beta answer"]


@pytest.mark.asyncio
async def test_clear_history_drops_all_records_for_a_device():
    await memory.record_turn("dev-lamp", "ephemeral", "text")
    assert len(await memory.get_recent_turns("dev-lamp")) == 1
    await memory.clear_history("dev-lamp")
    assert await memory.get_recent_turns("dev-lamp") == []


@pytest.mark.asyncio
async def test_prompt_block_renders_chronologically():
    """Render order should be oldest-first so the model reads naturally."""
    await memory.record_turn("dev-lamp", "First", "text")
    await memory.record_turn("dev-lamp", "Second", "latex")
    turns = await memory.get_recent_turns("dev-lamp")
    rendered = memory.render_history_for_prompt(turns)
    assert "First" in rendered
    assert "Second" in rendered
    # Oldest first → "First" should appear before "Second" in the rendered text.
    assert rendered.index("First") < rendered.index("Second")


def test_empty_history_renders_to_empty_string():
    assert memory.render_history_for_prompt([]) == ""


@pytest.mark.asyncio
async def test_record_turn_swallows_redis_failures_gracefully(monkeypatch):
    """The live response path must never break because Redis hiccuped."""

    class _Broken:
        async def lpush(self, *a, **kw):
            raise RuntimeError("simulated redis outage")

        async def ltrim(self, *a, **kw):
            raise RuntimeError("simulated redis outage")

        async def expire(self, *a, **kw):
            raise RuntimeError("simulated redis outage")

    monkeypatch.setattr(redis_client, "_client", _Broken())
    # Must not raise.
    await memory.record_turn("dev-lamp", "this fails", "text")
