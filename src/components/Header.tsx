import { AUTHOR_X, REPO_URL } from '../content.ts';
import { IconGithub, IconMoon, IconShield, IconSun, IconTrash, IconX } from './icons.tsx';

export interface HeaderProps {
  theme: 'system' | 'light' | 'dark';
  onThemeChange: (t: 'system' | 'light' | 'dark') => void;
  onClearAll: () => void;
  canClear: boolean;
}

const THEME_ORDER: Array<{ key: 'system' | 'light' | 'dark'; label: string }> = [
  { key: 'system', label: '跟随系统' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' },
];

export function Header({ theme, onThemeChange, onClearAll, canClear }: HeaderProps) {
  const cycle = () => {
    const idx = THEME_ORDER.findIndex((t) => t.key === theme);
    onThemeChange(THEME_ORDER[(idx + 1) % THEME_ORDER.length].key);
  };
  const label = THEME_ORDER.find((t) => t.key === theme)?.label ?? '跟随系统';

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <a className="brand" href="./" aria-label="GhostPixel 首页">
          <span className="brand-mark" aria-hidden>
            <IconShield style={{ width: 16, height: 16 }} />
          </span>
          GhostPixel
          <span className="brand-sub">图片元数据清理</span>
        </a>

        <div className="topbar-spacer" />

        <div className="topbar-actions">
          {canClear && (
            <button className="icon-btn" onClick={onClearAll} aria-label="一键清空工作区" title="一键清空工作区">
              <IconTrash />
            </button>
          )}
          <button className="icon-btn" onClick={cycle} aria-label={`切换主题（当前：${label}）`} title={`主题：${label}`}>
            {theme === 'dark' ? <IconMoon /> : <IconSun />}
          </button>
          <a className="icon-btn" href={REPO_URL} target="_blank" rel="noreferrer noopener" aria-label="GitHub 源码仓库" title="GitHub 源码仓库">
            <IconGithub />
          </a>
          {/* 作者 𝕏 入口 —— 顶部固定展示 */}
          <a
            className="x-link"
            href={AUTHOR_X.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`作者 X（Twitter）主页 ${AUTHOR_X.handle}`}
            title={`作者 𝕏 ${AUTHOR_X.handle}`}
            data-testid="x-link"
          >
            <IconX />
            <span className="x-handle">{AUTHOR_X.handle}</span>
          </a>
        </div>
      </div>
    </header>
  );
}
