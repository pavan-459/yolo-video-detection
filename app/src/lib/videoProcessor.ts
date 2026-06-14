import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import Video from './models/Video';

const ML_SERVER = process.env.ML_SERVER_URL || 'http://localhost:5000';

// Only override the ffmpeg path if explicitly set in the environment.
// Otherwise fluent-ffmpeg auto-detects from the system PATH.
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

function emit(uploadId: string, event: string, data: unknown) {
  if (global.io) global.io.to(uploadId).emit(event, data);
}

async function extractFrames(filePath: string, framesDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .outputOptions(['-vf', 'fps=1'])
      .output(path.join(framesDir, 'frame-%04d.png'))
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`FFmpeg failed: ${err.message}`)))
      .run();
  });
}

async function detectFrame(framePath: string): Promise<unknown[]> {
  try {
    const imageData = fs.readFileSync(framePath).toString('base64');
    const response = await axios.post(
      `${ML_SERVER}/detect`,
      { image: imageData },
      { timeout: 30000 }
    );
    return response.data.objects || [];
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNREFUSED') {
        throw new Error('Flask ML server is not running. Start it with: python app.py');
      }
      if (err.code === 'ETIMEDOUT') {
        console.warn(`[detectFrame] Timeout on ${path.basename(framePath)}, skipping`);
        return [];
      }
    }
    console.warn(`[detectFrame] Failed on ${path.basename(framePath)}:`, err);
    return [];
  }
}

export async function processVideo(uploadId: string, filePath: string) {
  const framesDir = path.join(process.cwd(), 'uploads', 'frames', uploadId);

  const fail = async (message: string) => {
    console.error(`[processVideo] ${uploadId}: ${message}`);
    await Video.findOneAndUpdate({ uploadId }, { status: 'failed', error: message });
    emit(uploadId, 'status', { uploadId, status: 'failed', error: message });
  };

  try {
    if (!fs.existsSync(filePath)) {
      await fail('Uploaded file not found on disk');
      return;
    }

    // Step 1 — Extract frames
    fs.mkdirSync(framesDir, { recursive: true });
    await Video.findOneAndUpdate({ uploadId }, { status: 'extracting' });
    emit(uploadId, 'status', { uploadId, status: 'extracting' });

    await extractFrames(filePath, framesDir);

    const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();

    if (frames.length === 0) {
      await fail('FFmpeg extracted 0 frames — video may be corrupt or too short');
      return;
    }

    // Step 2 — Run YOLO detection per frame
    await Video.findOneAndUpdate({ uploadId }, { status: 'detecting' });
    emit(uploadId, 'status', { uploadId, status: 'detecting' });

    const results = [];
    for (let i = 0; i < frames.length; i++) {
      const framePath = path.join(framesDir, frames[i]);
      const objects = await detectFrame(framePath);
      results.push({ frameIndex: i, timestamp: i, objects });
      emit(uploadId, 'progress', { uploadId, frame: i, total: frames.length });
    }

    // Step 3 — Save results and mark complete
    await Video.findOneAndUpdate({ uploadId }, { status: 'completed', results });
    emit(uploadId, 'status', { uploadId, status: 'completed', results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown processing error';
    await fail(message);
  } finally {
    // Clean up temp frames only — keep the original upload file for video streaming
    try {
      if (fs.existsSync(framesDir)) {
        fs.rmSync(framesDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn(`[processVideo] Failed to clean up frames for ${uploadId}:`, cleanupErr);
    }
  }
}
