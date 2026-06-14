import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import Video from '@/lib/models/Video';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { processVideo } from '@/lib/videoProcessor';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const userId = (session.user as { id: string }).id;
  const videos = await Video.find({ userId }).sort({ createdAt: -1 }).select('-framesData');
  return NextResponse.json({ videos });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('video') as File | null;

  if (!file) return NextResponse.json({ error: 'No video file provided' }, { status: 400 });

  const allowed = ['video/mp4', 'video/quicktime'];
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: 'Only MP4 and MOV files are allowed' }, { status: 400 });
  }
  if (file.size > 100 * 1024 * 1024) {
    return NextResponse.json({ error: 'File size must be under 100MB' }, { status: 400 });
  }

  const uploadId = uuidv4();
  const ext = file.name.split('.').pop();
  const filename = `${uploadId}.${ext}`;
  const uploadDir = path.join(process.cwd(), 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  await connectDB();
  const userId = (session.user as { id: string }).id;

  await Video.create({
    uploadId,
    filename,
    originalName: file.name,
    status: 'pending',
    userId,
    framesData: [],
    results: [],
  });

  // Kick off processing asynchronously
  processVideo(uploadId, filePath).catch(console.error);

  return NextResponse.json({ uploadId, message: 'Video uploaded successfully' }, { status: 201 });
}
