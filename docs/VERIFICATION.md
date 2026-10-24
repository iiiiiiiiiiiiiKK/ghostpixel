# 验证记录

本文件记录**真实执行**的测试与线上验证输出，不是预期结果。

- 执行时间：2026-10-25（UTC+8）
- 线上地址：<https://iiiiiiiiiiiiiKK.github.io/ghostpixel/>
- 部署方式：GitHub Pages（GitHub Actions 自动构建发布）

---

## 1. 构建

```
$ BASE_PATH=/ghostpixel/ pnpm build

vite v7.3.7 building client environment for production...
✓ 46 modules transformed.
dist/index.html                   1.22 kB │ gzip:   0.75 kB
dist/assets/index-1lUbNH_2.css   18.14 kB │ gzip:   4.39 kB
dist/assets/index-Cs43DS5H.js   381.51 kB │ gzip: 127.96 kB
✓ built in 1.81s
```

类型检查：

```
$ pnpm typecheck    # tsc -b
TSC_EXIT=0
```

---

## 2. 单元测试（28 个，全部通过）

```
$ pnpm test

 ✓ tests/unit/containers.test.ts (20 tests) 35ms
 ✓ tests/unit/pipeline.test.ts  (8 tests)  31ms

 Test Files  2 passed (2)
      Tests  28 passed (28)
```

覆盖的关键断言：

| 领域 | 具体断言 |
| :--- | :--- |
| 格式识别 | 魔数识别 JPEG/PNG/WebP/GIF；文本文件识别为 unknown |
| JPEG 扫描 | 找到 APP1 与 COM；APP0/JFIF 与 DQT 被保留；像素段被保留 |
| JPEG 剥离 | 剥离后无可移除块、尺寸不变、文件变小 |
| ICC 开关 | `keepIcc: true` 时 APP2 保留 |
| 截断文件 | 标记 `truncated: true` 并给出警告 |
| PNG 扫描 | 识别 tEXt / iTXt；能读出 Author 文本 |
| PNG 剥离 | 签名与 IHDR/IDAT/IEND 完整；文本块全部消失 |
| PNG 尾部数据 | IEND 之后 12 字节附加数据被识别并移除 |
| WebP | RIFF 长度字段被正确修正；VP8X 标志位同步 |
| GIF | 注释块被识别并移除，帧数据完整 |
| 伪造/损坏 | 伪造 PNG 魔数被标记为结构损坏 |
| 报告结构 | 嵌套壳层被跳过，只保留叶子字段 |
| **像素无损** | **剥离前后 SCAN 段字节完全一致（逐字节比较）** |

最后一项是本项目最核心的断言：

```ts
const originalPixels = bytes.subarray(scanSeg.offset, scanSeg.offset + scanSeg.size);
const outPixels = out.subarray(outScanSeg.offset, outScanSeg.offset + outScanSeg.size);
expect(Buffer.from(outPixels).equals(Buffer.from(originalPixels))).toBe(true);
```

---

## 3. 外部独立验证（Pillow，不依赖本项目代码）

`tests/unit/pipeline.test.ts` 会把清理结果写入 `tmp-cleaned/`，然后用 Python + Pillow 独立打开：

```
$ python scripts/verify_cleaned.py

animated-comment-cleaned.gif:       size=(640, 480) format=GIF  mode=P
   exif tags=0 gps_tags=0 png_text=0 info_keys=[]
transparent-with-text-cleaned.png:  size=(512, 512) format=PNG  mode=RGBA
   exif tags=0 gps_tags=0 png_text=0 info_keys=[]
with-exif-cleaned.webp:             size=(640, 480) format=WEBP mode=RGB
   exif tags=0 gps_tags=0 png_text=0 info_keys=[]
with-exif-gps-cleaned.jpg:          size=(640, 480) format=JPEG mode=RGB
   exif tags=0 gps_tags=0 png_text=0 info_keys=[]
EXIT=0
```

四类格式清理后：

- EXIF tag 数：**0**
- GPS tag 数：**0**
- PNG 文本块：**0**
- `image.info` 中的元数据 key：**空**
- 尺寸与色彩模式：全部保持原样（PNG 仍是 RGBA，透明通道未丢）

这个验证很重要：它用的解析器（Pillow）和我们自己的解析器（exifr + 自研）完全不同，
两边都说「没有元数据」，才能排除「我们的解析器漏读」这种可能。

---

## 4. E2E 测试（26 个，全部通过）

```
$ pnpm test:e2e

Running 26 tests using 1 worker

[desktop]
  ok  1 上传含 EXIF/GPS 的图片 → 显示元数据 → 清理 → 下载       (1.5s)
  ok  2 不支持的文件显示可理解的错误，而不是崩溃                 (551ms)
  ok  3 损坏文件被标记为结构不完整                              (621ms)
  ok  4 批量：多张图片 + 一键清理 + 打包下载 + 清空工作区        (901ms)
  ok  5 主题切换：浅色 / 深色都会改变页面背景                    (642ms)
  ok  6 键盘可达：Tab 能聚焦到上传区域并触发文件选择              (446ms)
  ok  7 自适应 @320px：无横向溢出且 𝕏 入口可见                  (542ms)
  ok  8 自适应 @390px                                           (574ms)
  ok  9 自适应 @414px                                           (572ms)
  ok 10 自适应 @768px                                           (563ms)
  ok 11 自适应 @1280px                                          (565ms)
  ok 12 深色模式下仍然可读                                       (434ms)
  ok 13 清理过程不产生任何外部网络请求                            (655ms)

[mobile — iPhone 13 视口 390×844, isMobile + hasTouch]
  ok 14-26 全部通过

  26 passed (23.5s)
```

### 关于「移动端自适应」的验证方法

用 Playwright 的 `devices['iPhone 13']` 配置（viewport 390×844、DPR 3、`isMobile: true`、`hasTouch: true`、
iPhone Safari 的 UA），在 Chromium 里模拟。**这不是真机 WebKit 测试**，说明如下：

- ✅ 验证了：布局断点、横向溢出、触控目标尺寸、`𝕏` 入口在窄屏收成图标
- ❌ 未验证：Safari 特有的 CSS 行为（如 `backdrop-filter` 的性能、`color-mix()` 的旧版支持）
- 补充：线上验证里也单独测了 390px 视口下的完整流程（见下一节）

`color-mix()` 需要 Safari 16.2+，`backdrop-filter` 需要 Safari 9+（带前缀）。这两个特性即使不支持，
也是**降级**（毛玻璃变纯色、混合色变透明），不影响任何功能。

---

## 5. 线上端到端验证（18 项，全部通过）

```
$ node scripts/verify-live.mjs

✔ 线上首页可访问 — HTTP 200
✔ 页面标题正确 — GhostPixel · 图片元数据检查与清理
✔ 顶栏 𝕏 入口存在
✔ 𝕏 链接指向 0xkillcoin
✔ 𝕏 入口可见
✔ 检测到 GPS 纬度
✔ 检测到设备型号
✔ 检测到拍摄时间
✔ GPS 红色提示出现
✔ 复检验证通过
✔ 导出容器无残留块
✔ 残留字段为 0
✔ 可下载清理后的图片 — with-exif-gps.cleaned.jpg (14023 bytes)
✔ 全程无外部网络请求 — 0 requests
✔ iPhone 视口无横向溢出 — 390 <= 390
✔ 移动端 𝕏 入口可见且可点 — 34×34
✔ 移动端清理成功
✔ 移动端处理后仍无溢出 — 390 <= 390

18/18 passed
```

注意第 14 项：**全程无外部网络请求**。验证方式是监听 Playwright 的 `request` 事件，
过滤掉同源请求、`blob:` 与 `data:`，其余一律记录 —— 结果为空数组。

原始导出文件大小 14023 字节，与 Pillow 独立验证的 `with-exif-gps-cleaned.jpg` 一致。

---

## 6. 已知偏差说明

| 项目 | 说明 |
| :--- | :--- |
| CI 里跑的是 Chromium | GitHub Actions 不下载 WebKit（体积大、耗时长）。iOS Safari 的真机验证需要人工或 BrowserStack |
| `dist/` 不提交 | GitHub Actions 每次构建，符合静态站最佳实践 |
| 测试图片是生成的 | `public/fixtures/` 全部由 `scripts/make_fixtures.py` 用 Pillow 生成，可复现，不含任何真实用户数据 |
| 截图来自本地构建 | `docs/screenshots/` 用 `scripts/shoot.mjs` 对 `vite preview` 抓取；线上长这样，内容一致 |

---

## 7. 复现

```bash
pnpm install
python scripts/make_fixtures.py   # 重新生成测试图片
pnpm test                          # 28 个单元测试
pnpm build
pnpm test:e2e                      # 26 个 E2E
node scripts/verify-live.mjs       # 18 项线上验证（需要已部署）
```
