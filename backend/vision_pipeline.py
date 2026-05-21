import cv2
import numpy as np
import logging

logger = logging.getLogger(__name__)

class VisionPipeline:
    def __init__(self):
        # Background subtractor to isolate hand/pen movements from static desk
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=16, detectShadows=False)
        # CLAHE for illumination normalization
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

    def process_frame(self, frame_bytes: bytes) -> tuple[bytes, dict]:
        """
        Process incoming raw JPEG bytes from the ESP32-CAM.
        Returns:
            - compressed_jpg_bytes: The optimized/cropped image ready for Gemini API.
            - metadata: Dictionary containing info like `writing_detected`.
        """
        try:
            # Decode JPEG byte stream to OpenCV BGR image
            nparr = np.frombuffer(frame_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if frame is None:
                raise ValueError("Could not decode frame.")

            # 1. Illumination Normalization (CLAHE on L-channel)
            lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            l_eq = self.clahe.apply(l)
            lab_eq = cv2.merge((l_eq, a, b))
            frame_eq = cv2.cvtColor(lab_eq, cv2.COLOR_LAB2BGR)

            # 2. Movement/Writing Detection
            fg_mask = self.bg_subtractor.apply(frame_eq)
            # Threshold to remove slight noise
            _, fg_mask = cv2.threshold(fg_mask, 200, 255, cv2.THRESH_BINARY)
            active_pixels = cv2.countNonZero(fg_mask)
            
            # Simple heuristic: if enough pixels changed, someone is writing or turning a page
            writing_detected = active_pixels > 500  

            # 3. Compression (Quality 60) for latency reduction
            # Here we just encode the equalized frame directly for the prototype.
            # (Perspective warping can be added here if needed to isolate the notebook surface).
            encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 60]
            success, compressed_frame = cv2.imencode('.jpg', frame_eq, encode_param)

            if not success:
                raise ValueError("Could not encode frame to JPEG.")

            return compressed_frame.tobytes(), {"writing_detected": writing_detected, "active_pixels": active_pixels}

        except Exception as e:
            logger.error(f"Vision pipeline error: {e}")
            # Fallback: return original bytes if processing fails
            return frame_bytes, {"writing_detected": False, "error": str(e)}
