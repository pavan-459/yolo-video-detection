import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import Video from './models/Video';

const ML_SERVER = process.env.ML_SERVER_URL || 'http://localhost:5000';

// Point fluent-ffmpeg at the winget-installed binary so it works
// regardless of which terminal PATH the Node process inherited.
const FFMPEG_PATH =
  process.env.FFMPEG_PATH ||
  'C:\\Users\\Pavan Krishna N\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe';

ffmpeg.setFfmpegPath(FFMPEG_PATH);

export async function processVideo(uploadId: string, filePath: string) {
  const framesDir = path.join(process.cwd(), 'uploads', 'frames', uploadId);
  fs.mkdirSync(framesDir, { recursive: true });

  const emit = (event: string, data: unknown) => {
    if (global.io) global.io.to(uploadId).emit(event, data);
  };

  try {
    // Extract frames at 1 fps
    await Video.findOneAndUpdate({ uploadId }, { status: 'extracting' });
    emit('status', { uploadId, status: 'extracting' });

    await new Promise<void>((resolve, reject) => {
      ffmpeg(filePath)
        .outputOptions(['-vf', 'fps=1'])
        .output(path.join(framesDir, 'frame-%04d.png'))
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });

    const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();

    // Run YOLO detection per frame
    await Video.findOneAndUpdate({ uploadId }, { status: 'detecting' });
    emit('status', { uploadId, status: 'detecting' });

    const results = [];
    for (let i = 0; i < frames.length; i++) {
      const framePath = path.join(framesDir, frames[i]);
      const imageData = fs.readFileSync(framePath).toString('base64');

      try {
        const response = await axios.post(`${ML_SERVER}/detect`, { image: imageData });
        results.push({
          frameIndex: i,
          timestamp: i, // 1 fps so frame index == second
          objects: response.data.objects || [],
        });
        emit('progress', { uploadId, frame: i, total: frames.length });
      } catch {
        results.push({ frameIndex: i, timestamp: i, objects: [] });
      }
    }

    await Video.findOneAndUpdate({ uploadId }, { status: 'completed', results, framesData: frames });
    emit('status', { uploadId, status: 'completed', results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Processing failed';
    await Video.findOneAndUpdate({ uploadId }, { status: 'failed', error: message });
    emit('status', { uploadId, status: 'failed', error: message });
  } finally {
    // Clean up temp frames
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}
