import { useEffect, useState } from 'react';

// Only mounted for the active slide, so leaving a demo cancels its playback.
export default function useDemoClock() {
  const [elapsed, setElapsed] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? Infinity : 0,
  );
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const start = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - start), 40);
    return () => clearInterval(timer);
  }, []);
  return elapsed;
}
