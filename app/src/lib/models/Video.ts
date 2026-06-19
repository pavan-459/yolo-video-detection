import mongoose, { Schema, Document } from 'mongoose';

export type VideoStatus = 'pending' | 'extracting' | 'detecting' | 'completed' | 'failed';

export interface DetectionResult {
  frameIndex: number;
  timestamp: number;
  objects: Array<{
    label: string;
    confidence: number;
    bbox: [number, number, number, number];
  }>;
}

export interface IVideo extends Document {
  uploadId: string;
  filename: string;
  originalName: string;
  status: VideoStatus;
  userId: mongoose.Types.ObjectId;
  results: DetectionResult[];
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DetectionObjectSchema = new Schema(
  { label: String, confidence: Number, bbox: [Number] },
  { _id: false }
);

const DetectionResultSchema = new Schema(
  { frameIndex: Number, timestamp: Number, objects: [DetectionObjectSchema] },
  { _id: false }
);

const VideoSchema = new Schema<IVideo>(
  {
    uploadId: { type: String, required: true, unique: true },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'extracting', 'detecting', 'completed', 'failed'],
      default: 'pending',
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    results: [DetectionResultSchema],
    error: String,
  },
  { timestamps: true }
);

// Speeds up dashboard list queries (user's videos sorted by newest)
VideoSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.Video || mongoose.model<IVideo>('Video', VideoSchema);
