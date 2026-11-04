import { forwardRef, type CSSProperties, type ImgHTMLAttributes } from 'react';
import { mediaEntry, mediaUrl, srcSet } from './media';

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'width' | 'height'> {
  id: string;
  alt: string;
  sizes?: string;
  /** Eager-load and raise priority (above-the-fold media only). */
  priority?: boolean;
  pixelated?: boolean;
  imgClassName?: string;
  style?: CSSProperties;
}

/**
 * <picture> with AVIF and WebP sources at every generated width. Intrinsic
 * width/height reserve space, so nothing shifts while images load.
 */
export const Picture = forwardRef<HTMLImageElement, Props>(function Picture(
  { id, alt, sizes = '100vw', priority, pixelated, className, imgClassName, style, ...rest },
  ref,
) {
  const e = mediaEntry(id);
  if (e.png) {
    return (
      <img
        ref={ref}
        src={mediaUrl(id, undefined, 'png')}
        width={e.width}
        height={e.height}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className={className ?? imgClassName}
        style={{ imageRendering: pixelated ? 'pixelated' : undefined, ...style }}
        {...rest}
      />
    );
  }
  const largest = e.widths[e.widths.length - 1];
  return (
    <picture className={className} style={style}>
      <source type="image/avif" srcSet={srcSet(id, 'avif')} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(id, 'webp')} sizes={sizes} />
      <img
        ref={ref}
        src={mediaUrl(id, largest, 'webp')}
        width={e.width}
        height={e.height}
        alt={alt}
        sizes={sizes}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : undefined}
        className={imgClassName}
        {...rest}
      />
    </picture>
  );
});
