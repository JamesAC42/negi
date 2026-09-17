import { memo, useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { useArtworkVisibility } from "./useArtworkVisibility";
import { getArtworkObjectUrl } from "../artwork-requests";

// Small image-only counterpart to the library's Artwork component. Both use
// the same request budget so artist shortcuts cannot crowd out API calls.
export const ArtworkImage = memo(function ArtworkImage({ src, loading = "lazy", style, ...props }: ComponentPropsWithoutRef<"img"> & { src: string }) {
  const { ref, visible } = useArtworkVisibility(loading === "eager");
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
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
  return <img {...props} ref={ref} src={visible ? url : undefined} loading="eager" decoding="async" style={failed ? { ...style, display: "none" } : style} />;
});
