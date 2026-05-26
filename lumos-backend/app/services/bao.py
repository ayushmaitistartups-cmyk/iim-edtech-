"""Base Answer Once (BAO) framework turn manager."""

import logging
import uuid
from typing import Optional
from dataclasses import dataclass
from Levenshtein import ratio

from app.storage.redis_client import get_redis

logger = logging.getLogger(__name__)


@dataclass
class BaoContext:
    is_new_question: bool
    question_hash: str
    attempt_count: int
    msm_text: str | None


async def detect_question_hash(session_id: str, new_transcript: str) -> str:
    """Hash the question based on transcript similarity.
    
    If the new transcript is >80% similar to the last stored transcript, 
    we consider it the same question and return the same hash.
    Otherwise, we generate a new hash.
    """
    redis = get_redis()
    key_transcript = f"last_transcript:{session_id}"
    key_hash = f"last_hash:{session_id}"
    
    last_transcript = await redis.get(key_transcript)
    
    if last_transcript:
        last_transcript_str = last_transcript.decode("utf-8")
        similarity = ratio(new_transcript.lower(), last_transcript_str.lower())
        
        if similarity > 0.8:
            # Same question, return the existing hash
            last_hash = await redis.get(key_hash)
            if last_hash:
                logger.info(f"BAO: Found same question (similarity {similarity:.2f})")
                return last_hash.decode("utf-8")
                
    # New question
    new_hash = uuid.uuid4().hex[:8]
    logger.info(f"BAO: New question detected, hash {new_hash}")
    
    await redis.set(key_transcript, new_transcript, ex=3600)
    await redis.set(key_hash, new_hash, ex=3600)
    
    # Reset attempt count
    await redis.delete(f"attempt_count:{session_id}:{new_hash}")
    
    return new_hash


async def get_or_increment_attempt(session_id: str, question_hash: str) -> int:
    """Increment and return the attempt count for this question."""
    redis = get_redis()
    key = f"attempt_count:{session_id}:{question_hash}"
    count = await redis.incr(key)
    await redis.expire(key, 3600)
    return count


async def get_msm(session_id: str, question_hash: str) -> Optional[str]:
    """Retrieve the cached Master Solution Model (MSM) from Turn 1."""
    redis = get_redis()
    key = f"msm:{session_id}:{question_hash}"
    msm = await redis.get(key)
    if msm:
        return msm.decode("utf-8")
    return None


async def save_msm(session_id: str, question_hash: str, msm_text: str) -> None:
    """Cache the Master Solution Model (MSM) from Turn 1."""
    redis = get_redis()
    key = f"msm:{session_id}:{question_hash}"
    await redis.set(key, msm_text, ex=1800)  # 30 minute TTL as per design

