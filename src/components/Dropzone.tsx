import { useCallback, useRef, useState } from 'react';
import { IconUpload } from './icons.tsx';

export interface DropzoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/tiff,image/bmp';

export function Dropzone({ onFiles, disabled }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles],
  );

  return (
    <>
      <button
        type="button"
        className={`dropzone${dragging ? ' is-dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          depth.current -= 1;
          if (depth.current <= 0) setDragging(false);
        }}
        onDrop={handleDrop}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="选择或拖放图片文件"
        data-testid="dropzone"
        disabled={disabled}
      >
        <span className="dz-icon">
          <IconUpload style={{ width: 22, height: 22 }} />
        </span>
        <span className="dz-title">拖放图片到这里，或点击选择</span>
        <span className="dz-hint">可以一次选择多张，最多 12 张。整个处理过程不会产生任何网络请求。</span>
        <span className="dz-formats">JPEG · PNG · WebP · GIF 支持无损清理；TIFF · BMP · AVIF · HEIC 会重编码</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="visually-hidden"
        data-testid="file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          // 允许重复选择同一个文件。
          e.target.value = '';
        }}
      />
    </>
  );
}
