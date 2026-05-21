import asyncio
import json
import logging
from typing import Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from Levenshtein import distance as lev_distance

from vision_pipeline import VisionPipeline
from gemini_client import GeminiTutorClient

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ClarityAI Middleware Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

vision_pipeline = VisionPipeline()
gemini_client = GeminiTutorClient()

# sessions maps session_id -> {
#   "client_ws": WebSocket,
#   "latest_frame": bytes,
#   "last_ocr_text": str,
#   "messages": list,
#   "current_task": asyncio.Task
# }
sessions: Dict[str, dict] = {}

async def process_chat_turn(session_id: str, payload: dict):
    session_data = sessions[session_id]
    websocket = session_data["client_ws"]
    
    session_data["messages"].append({"role": "user", "content": payload["content"]})
    image_bytes = session_data.get("latest_frame")
    
    try:
        # Latency Masking: Step 1
        await websocket.send_text(json.dumps({"type": "status", "message": "Analyzing context and extracting state..."}))
        
        # Extract Session State
        state = await gemini_client.extract_session_state(session_data["messages"], image_bytes)
        
        # Latency Masking: Step 2
        await websocket.send_text(json.dumps({"type": "status", "message": "Tutor is crafting hint..."}))
        
        # Generate Tutor Response (Guardrails handled internally)
        full_response = await gemini_client.generate_tutor_response(session_data["messages"], image_bytes, state)
        
        # We simulate a stream output since the client UI expects tokens for progressive speaking.
        # But we already have the full string due to guardrails.
        # We can chunk it out locally.
        words = full_response.split(" ")
        for word in words:
            await asyncio.sleep(0.05) # Fake streaming delay to allow UI to render & TTS to start smoothly
            await websocket.send_text(json.dumps({
                "type": "chat_token",
                "content": word + " "
            }))
        
        await websocket.send_text(json.dumps({"type": "chat_done"}))
        session_data["messages"].append({"role": "assistant", "content": full_response})
        
    except asyncio.CancelledError:
        logger.info(f"Task for session {session_id} was interrupted (Barge-In).")
        await websocket.send_text(json.dumps({"type": "chat_done"}))
    except Exception as e:
        logger.error(f"Error processing chat turn: {e}")
        await websocket.send_text(json.dumps({"type": "chat_done"}))

@app.websocket("/ws/client/{session_id}")
async def client_websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    
    if session_id not in sessions:
        sessions[session_id] = {
            "client_ws": websocket, 
            "latest_frame": None, 
            "last_ocr_text": "",
            "messages": [],
            "current_task": None
        }
    else:
        sessions[session_id]["client_ws"] = websocket

    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            if payload.get("type") == "chat_message":
                # If there's an ongoing task, cancel it (Barge-In)
                if sessions[session_id]["current_task"]:
                    sessions[session_id]["current_task"].cancel()
                    
                # Start new task for the chat turn
                task = asyncio.create_task(process_chat_turn(session_id, payload))
                sessions[session_id]["current_task"] = task
                
            elif payload.get("type") == "interrupt":
                # Barge-in triggered mid-speech or mid-generation
                if sessions[session_id]["current_task"]:
                    sessions[session_id]["current_task"].cancel()
                    sessions[session_id]["current_task"] = None

    except WebSocketDisconnect:
        logger.info(f"Client {session_id} disconnected")
    except Exception as e:
        logger.error(f"Client error: {e}")
    finally:
        if session_id in sessions and sessions[session_id]["client_ws"] == websocket:
            sessions[session_id]["client_ws"] = None


async def run_ocr_debouncer(session_id: str, image_bytes: bytes):
    # This runs asynchronously to prevent blocking hardware frame ingestion
    try:
        new_text = await gemini_client.extract_text_from_image(image_bytes)
        old_text = sessions[session_id].get("last_ocr_text", "")
        
        # Calculate Levenshtein distance similarity
        if old_text and new_text:
            max_len = max(len(old_text), len(new_text))
            dist = lev_distance(old_text, new_text)
            diff_ratio = dist / max_len
            
            if diff_ratio > 0.15:
                # Page turned or significant new writing!
                client_ws = sessions[session_id].get("client_ws")
                if client_ws:
                    await client_ws.send_text(json.dumps({
                        "type": "hardware_event",
                        "event": "page_turned"
                    }))
        
        sessions[session_id]["last_ocr_text"] = new_text
        
    except Exception as e:
        logger.error(f"OCR Debouncer Error: {e}")


@app.websocket("/ws/hardware/{session_id}")
async def hardware_websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    
    if session_id not in sessions:
        sessions[session_id] = {
            "client_ws": None, 
            "latest_frame": None, 
            "last_ocr_text": "",
            "messages": [],
            "current_task": None
        }

    try:
        frame_counter = 0
        while True:
            raw_frame_bytes = await websocket.receive_bytes()
            compressed_frame, metadata = vision_pipeline.process_frame(raw_frame_bytes)
            
            sessions[session_id]["latest_frame"] = compressed_frame
            
            # Every 5th frame, run OCR Debouncer to check for significant context change
            frame_counter += 1
            if frame_counter % 5 == 0:
                asyncio.create_task(run_ocr_debouncer(session_id, compressed_frame))
                
    except WebSocketDisconnect:
        logger.info(f"Hardware {session_id} disconnected")
    except Exception as e:
        logger.error(f"Hardware error: {e}")
