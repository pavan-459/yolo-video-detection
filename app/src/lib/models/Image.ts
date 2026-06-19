import mongoose, { Schema, Document } from 'mongoose';

export interface DetectionObject {
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface IImage extends Document {
  imageId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  userId: mongoose.Types.ObjectId;
  objects: DetectionObject[];
  createdAt: Date;
  updatedAt: Date;
}

const DetectionObjectSchema = new Schema(
  { label: String, confidence: Number, bbox: [Number] },
  { _id: false }
);

const ImageSchema = new Schema<IImage>(
  {
    imageId: { type: String, required: true, unique: true },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    objects: [DetectionObjectSchema],
  },
  { timestamps: true }
);

// Speeds up dashboard list queries
ImageSchema.index({ userId: 1, createdAt: -1 });

// Registered as 'PixelImage' to avoid collision with the global Image constructor
export default mongoose.models.PixelImage || mongoose.model<IImage>('PixelImage', ImageSchema);
