import base64
import io
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
from ultralytics import YOLO

app = Flask(__name__)
CORS(app)

# 20 MB max request size — base64 encoding inflates ~33%, so this covers ~15 MB raw images
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024

model = YOLO("yolov8n.pt")

# Warm the model with a blank image so the first real request isn't slow
_warmup = Image.new("RGB", (64, 64))
model(_warmup, verbose=False)
del _warmup


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/detect", methods=["POST"])
def detect():
    data = request.get_json()
    if not data or "image" not in data:
        return jsonify({"error": "No image provided"}), 400

    try:
        image_bytes = base64.b64decode(data["image"])
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        results = model(image, verbose=False)
        objects = []

        for result in results:
            boxes = result.boxes
            for box in boxes:
                label = model.names[int(box.cls[0])]
                confidence = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                objects.append({
                    "label": label,
                    "confidence": round(confidence, 4),
                    "bbox": [round(x1), round(y1), round(x2 - x1), round(y2 - y1)],
                })

        return jsonify({"objects": objects})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # Dev only — production uses Gunicorn (see Dockerfile)
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
