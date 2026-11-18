import Image, { type ImageProps } from "next/image";

// Worksheets are 1536×1024 PNGs served by the backend. Keep their original
// resolution for printing and load print-only images even when off-screen.
export function WorksheetImage(props: Omit<ImageProps, "unoptimized">) {
  const dimensions = props.fill ? {} : { width: 1536, height: 1024 };
  return <Image {...dimensions} loading="eager" {...props} alt={props.alt} unoptimized />;
}
