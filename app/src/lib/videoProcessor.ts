import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import Video from './models/Video';

const ML_SERVER = process.env.ML_SERVER_URL || 'http://localhost:5000';

// Only override if explicitly set — otherwise auto-detects from PATH
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

// Match Gunicorn worker count — 2 concurrent detection requests at a time
const DETECTION_CONCURRENCY = parseInt(process.env.DETECTION_CONCURRENCY || '2', 10);

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
    const response = await axios.post(`${ML_SERVER}/detect`, { image: imageData }, { timeout: 30000 });
    return response.data.objects || [];
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNREFUSED') {
        throw new Error('Flask ML server is not running. Start it with: python app.py');
      }
      if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
        console.warn(`[detectFrame] Timeout on ${path.basename(framePath)}, skipping`);
        return [];
      }
    }
    console.warn(`[detectFrame] Failed on ${path.basename(framePath)}:`, err);
    return [];
  }
}

// Process frames in batches of DETECTION_CONCURRENCY to match Gunicorn workers
async function detectFramesBatch(
  frames: string[],
  framesDir: string,
  uploadId: string
): Promise<Array<{ frameIndex: number; timestamp: number; objects: unknown[] }>> {
  const results: Array<{ frameIndex: number; timestamp: number; objects: unknown[] }> = new Array(frames.length);
  let completed = 0;

  for (let i = 0; i < frames.length; i += DETECTION_CONCURRENCY) {
    const batch = frames.slice(i, i + DETECTION_CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(async (frame, batchIdx) => {
        const globalIdx = i + batchIdx;
        const objects = await detectFrame(path.join(framesDir, frame));
        completed++;
        emit(uploadId, 'progress', { uploadId, frame: completed, total: frames.length });
        return { frameIndex: globalIdx, timestamp: globalIdx, objects };
      })
    );

    batchResults.forEach((r, batchIdx) => {
      results[i + batchIdx] = r;
    });
  }

  return results;
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

    // Step 2 — Run YOLO detection in parallel batches
    await Video.findOneAndUpdate({ uploadId }, { status: 'detecting' });
    emit(uploadId, 'status', { uploadId, status: 'detecting' });

    const results = await detectFramesBatch(frames, framesDir, uploadId);

    // Step 3 — Save and complete
    await Video.findOneAndUpdate({ uploadId }, { status: 'completed', results });
    emit(uploadId, 'status', { uploadId, status: 'completed', results });
  } catch (err) {
    await fail(err instanceof Error ? err.message : 'Unknown processing error');
  } finally {
    // Clean up temp frames — keep original upload for /stream route
    try {
      if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[processVideo] Frame cleanup failed for ${uploadId}:`, e);
    }
  }
}
