'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import Navbar from '@/components/Navbar';
import VideoUpload from '@/components/VideoUpload';
import ProgressTracker from '@/components/ProgressTracker';
import ResultsViewer from '@/components/ResultsViewer';

interface Video {
  uploadId: string;
  originalName: string;
  status: string;
  createdAt: string;
  results: unknown[];
}

export default function DashboardPage() {
  const { status } = useSession();
  const router = useRouter();
  const [videos, setVideos] = useState<Video[]>([]);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  const fetchVideos = useCallback(async () => {
    try {
      const res = await axios.get('/api/videos');
      setVideos(res.data.videos);
    } catch {
      // handled silently
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') fetchVideos();
  }, [status, fetchVideos]);

  const handleUploadComplete = (uploadId: string) => {
    setActiveUploadId(uploadId);
    fetchVideos();
  };

  const handleProcessingComplete = async () => {
    await fetchVideos();
    if (activeUploadId) {
      const res = await axios.get(`/api/videos/${activeUploadId}`);
      setSelectedVideo(res.data.video);
    }
  };

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 space-y-8">
        {/* Upload */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Upload Video</h2>
          <VideoUpload onUploadComplete={handleUploadComplete} />
        </section>

        {/* Processing status */}
        {activeUploadId && (
          <section>
            <ProgressTracker uploadId={activeUploadId} onComplete={handleProcessingComplete} />
          </section>
        )}

        {/* Results */}
        {selectedVideo && selectedVideo.status === 'completed' && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold mb-4">Detection Results — {selectedVideo.originalName}</h2>
            <ResultsViewer results={selectedVideo.results as Parameters<typeof ResultsViewer>[0]['results']} />
          </section>
        )}

        {/* Video history */}
        {videos.length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold mb-4">Your Videos</h2>
            <div className="divide-y divide-gray-100">
              {videos.map((v) => (
                <div key={v.uploadId} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{v.originalName}</p>
                    <p className="text-xs text-gray-400">{new Date(v.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full
                      ${v.status === 'completed' ? 'bg-green-100 text-green-700' :
                        v.status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-700'}`}>
                      {v.status}
                    </span>
                    {v.status === 'completed' && (
                      <button
                        onClick={async () => {
                          const res = await axios.get(`/api/videos/${v.uploadId}`);
                          setSelectedVideo(res.data.video);
                          setActiveUploadId(null);
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        View results
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
