"""Phase 4 long-term vector memory — file-backed fallback round-trip."""

import pytest

from app.storage import vector_memory


@pytest.fixture(autouse=True)
def _clean_user():
    vector_memory.reset_embedder_for_testing()
    vector_memory.clear_user_for_testing("test-user")
    yield
    vector_memory.clear_user_for_testing("test-user")


@pytest.mark.asyncio
async def test_remember_then_recall_round_trips_the_exact_content():
    await vector_memory.remember("test-user", "The integral of e^-x^2 from 0 to inf is sqrt(pi)/2", kind="qa")
    hits = await vector_memory.recall("test-user", "integral of e^-x^2 from 0 to inf is sqrt(pi)/2")
    assert hits
    assert "integral" in hits[0].content


@pytest.mark.asyncio
async def test_recall_orders_by_similarity_top_k():
    await vector_memory.remember("test-user", "Tomato is a fruit not a vegetable", kind="fact")
    await vector_memory.remember("test-user", "Pi is approximately 3.14159", kind="fact")
    await vector_memory.remember("test-user", "Mount Everest is in Nepal", kind="fact")

    # Query semantically aligned with 'pi'.
    hits = await vector_memory.recall("test-user", "Pi is approximately 3.14159", top_k=3)
    assert len(hits) == 3
    # With HashEmbedder, exact-string queries should return the matching record
    # as the top hit (cosine sim = 1.0 for identical vectors).
    assert hits[0].content == "Pi is approximately 3.14159"


@pytest.mark.asyncio
async def test_recall_returns_empty_for_user_with_no_memories():
    hits = await vector_memory.recall("nobody", "anything")
    assert hits == []


@pytest.mark.asyncio
async def test_prompt_renderer_includes_content_and_kind():
    await vector_memory.remember("test-user", "Magnetism is governed by Maxwell's equations", kind="fact")
    hits = await vector_memory.recall("test-user", "Magnetism is governed by Maxwell's equations")
    rendered = vector_memory.render_recall_for_prompt(hits)
    assert "Magnetism" in rendered
    assert "fact" in rendered


def test_render_empty_recall_yields_empty_string():
    assert vector_memory.render_recall_for_prompt([]) == ""


@pytest.mark.asyncio
async def test_memories_are_user_namespaced():
    await vector_memory.remember("user-A", "Alpha secret")
    await vector_memory.remember("user-B", "Beta secret")
    a = await vector_memory.recall("user-A", "Alpha secret")
    b = await vector_memory.recall("user-B", "Beta secret")
    assert any("Alpha" in m.content for m in a)
    assert all("Beta" not in m.content for m in a)
    assert any("Beta" in m.content for m in b)
    # Clean up
    vector_memory.clear_user_for_testing("user-A")
    vector_memory.clear_user_for_testing("user-B")
