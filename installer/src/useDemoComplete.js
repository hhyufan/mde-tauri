import { useEffect } from 'react';

export default function useDemoComplete(complete, onComplete) {
  useEffect(() => {
    if (complete) onComplete?.();
  }, [complete, onComplete]);
}
