'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface DetectionObject {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
}

interface Props {
  imageId: string;
  originalName: string;
  objects: DetectionObject[];
}

const COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

export default function ImageResult({ imageId, originalName, objects }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  const drawBoxes = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const scaleX = img.clientWidth / img.naturalWidth;
    const scaleY = img.clientHeight / img.naturalHeight;

    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    objects.forEach((obj, i) => {
      const color = COLORS[i % COLORS.length];
      const [x, y, w, h] = obj.bbox;
      const sx = x * scaleX;
      const sy = y * scaleY;
      const sw = w * scaleX;
      const sh = h * scaleY;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);

      const label = `${obj.label} ${Math.round(obj.confidence * 100)}%`;
      ctx.font = 'bold 12px sans-serif';
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = color;
      ctx.fillRect(sx, sy - 18, textWidth + 8, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, sx + 4, sy - 4);
    });
  }, [objects]);

  useEffect(() => {
    if (imgLoaded) drawBoxes();
  }, [imgLoaded, drawBoxes]);

  useEffect(() => {
    const handler = () => { if (imgLoaded) drawBoxes(); };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [imgLoaded, drawBoxes]);

  const uniqueLabels = [...new Set(objects.map((o) => o.label))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium text-gray-700">{originalName}</span>
        <span className="text-xs bg-violet-100 text-violet-700 px-2.5 py-0.5 rounded-full font-medium">
          {objects.length} object{objects.length !== 1 ? 's' : ''} detected
        </span>
        {uniqueLabels.map((label) => (
          <span key={label} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            {label}
          </span>
        ))}
      </div>

      <div className="relative inline-block w-full rounded-xl overflow-hidden bg-gray-900">
        {/* eslint-disable-next-line @next/next/no-img-element -- canvas overlay requires naturalWidth/naturalHeight from the raw img element */}
        <img
          ref={imgRef}
          src={`/api/images/${imageId}/file`}
          alt={originalName}
          className="w-full object-contain max-h-[480px]"
          onLoad={() => setImgLoaded(true)}
        />
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
      </div>

      {objects.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Label</th>
                <th className="px-4 py-3 text-left">Confidence</th>
                <th className="px-4 py-3 text-left">Bounding Box (x, y, w, h)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {objects.map((obj, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2 font-medium text-gray-800">{obj.label}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-1.5 max-w-[80px]">
                        <div className="bg-violet-500 h-1.5 rounded-full" style={{ width: `${obj.confidence * 100}%` }} />
                      </div>
                      <span className="text-gray-600">{Math.round(obj.confidence * 100)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-gray-500 font-mono text-xs">
                    {obj.bbox.map(Math.round).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-500 text-center py-6">No objects detected in this image.</p>
      )}

      <div className="flex gap-4">
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(objects, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${imageId}-detections.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-sm text-violet-600 hover:underline"
        >
          Export JSON
        </button>

        {imgLoaded && (
          <button
            onClick={() => {
              const img = imgRef.current;
              const canvas = canvasRef.current;
              if (!img || !canvas) return;

              // Composite: draw original image then overlay boxes on an offscreen canvas
              const out = document.createElement('canvas');
              out.width = img.clientWidth;
              out.height = img.clientHeight;
              const ctx = out.getContext('2d');
              if (!ctx) return;
              ctx.drawImage(img, 0, 0, out.width, out.height);
              ctx.drawImage(canvas, 0, 0);

              const a = document.createElement('a');
              a.href = out.toDataURL('image/png');
              a.download = `${imageId}-annotated.png`;
              a.click();
            }}
            className="text-sm text-violet-600 hover:underline"
          >
            Download annotated image
          </button>
        )}
      </div>
    </div>
  );
}
