import React from "react";

const { useEffect, useRef } = React;

export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

export function useLatest(value) {
  const latest = useRef(value);
  latest.current = value;
  return latest;
}
