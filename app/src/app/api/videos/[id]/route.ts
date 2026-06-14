import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import Video from '@/lib/models/Video';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  await connectDB();

  const userId = (session.user as { id: string }).id;
  const video = await Video.findOne({ uploadId: id, userId });
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  return NextResponse.json({ video });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  await connectDB();

  const userId = (session.user as { id: string }).id;
  const video = await Video.findOneAndDelete({ uploadId: id, userId });
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  return NextResponse.json({ message: 'Video deleted' });
}
