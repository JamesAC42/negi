import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { getArtworkObjectUrl } from "../artwork-requests";

// Small image-only counterpart to the library's Artwork component. Both use
// the same request budget so artist shortcuts cannot crowd out API calls.
export function ArtworkImage({ src, loading = "lazy", style, ...props }: ComponentPropsWithoutRef<"img"> & { src: string }) {
  const frame = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(loading === "eager");
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (visible) return;
    if (loading === "eager" || !frame.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px" });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [loading, visible]);
  useEffect(() => {
    setUrl(undefined);
    setFailed(false);
    if (!visible) return;
    const controller = new AbortController();
    void getArtworkObjectUrl(src, loading === "eager", controller.signal)
      .then((value) => { if (!controller.signal.aborted) setUrl(value); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [src, loading, visible]);
  return <img {...props} ref={frame} src={url} loading={loading} decoding="async" style={failed ? { ...style, display: "none" } : style} />;
}
