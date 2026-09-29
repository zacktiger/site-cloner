import { useEffect, useRef, useState } from "react";

// Renders the site at a real device width (e.g. 1440px for desktop) and scales it down
// to fit the available space, so "Desktop" really shows the desktop layout even in a
// narrow panel, instead of whatever breakpoint the panel width happens to hit.
export default function ScaledFrame({ src, width, title }: { src: string; width: number; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  const scale = size.width ? Math.min(1, size.width / width) : 1;

  return (
    <div ref={box} className="scaled-frame">
      <iframe
        src={src}
        title={title}
        style={{ width, height: size.height / scale, transform: `scale(${scale})` }}
      />
    </div>
  );
}
