# mob · Screen Buddy

已选定 **Screen Buddy（屏幕小搭档）** 为 mob 的正式 Logo：奶白色电脑外壳、紫色屏幕笑脸、薄荷绿鼠标指针，表达「看见远程桌面，让 AI 操作电脑」的产品能力。

<img src="../../public/logo.svg" alt="mob Screen Buddy 透明版" width="200" />
<img src="../../app-icon.svg" alt="mob macOS 应用图标" width="200" />

## 正式资源

| 文件 | 用途 |
| --- | --- |
| [logo.svg](../../public/logo.svg) | 透明底矢量 Logo；应用标题栏、首次连接页、新对话页、回复头像、About 页面及浏览器 favicon 共用 |
| [app-icon.svg](../../app-icon.svg) | macOS 应用图标母版；同一角色加奶白至淡紫色圆角底板，四周保留透明留白 |
| [icon.icns](../../src-tauri/icons/icon.icns) | macOS Dock、Finder 及打包时使用的多尺寸图标 |
| [icon.png](../../src-tauri/icons/icon.png) | 应用图标 PNG；同目录包含 Tauri 使用的其他尺寸 |

两个 SVG 均为 `512 × 512` 画布，不依赖外部字体或图片。修改角色时同步更新两个 SVG 的角色路径，再重新导出图标；图标母版只额外增加底板及居中偏移。

品牌色：主紫 `#6559E8`、浅紫 `#8B85FF`、深色描边 `#282347`、奶白 `#F9F4E9`、薄荷绿 `#B8ECCC`。保持原有比例，不拉伸或裁掉天线、手脚和指针；深色背景使用时保留角色本身的奶白填充。

## 重新生成图标

在仓库根目录运行，使用项目已安装的 Tauri CLI：

```bash
icon_dir=$(mktemp -d)
npm run tauri -- icon app-icon.svg --output "$icon_dir"
cp "$icon_dir"/*.png "$icon_dir"/*.icns "$icon_dir"/*.ico src-tauri/icons/
npm run build
```

这里只复制桌面图标，Tauri 附带生成的移动端目录留在临时目录。发布目标仍由 `src-tauri/tauri.conf.json` 和发布工作流决定；当前仅支持 macOS Apple Silicon。

图标已经接入 Tauri 配置引用的路径，正常执行 `npm run tauri build` 即会随应用打包，不需要额外的 GitHub Actions 配置。浏览器开发模式使用 `public/logo.svg`，不需要先生成原生图标。

## 设计归档

[三个候选方案](logo-concepts/README.md)及其静态对比图保留为设计过程记录；正式使用以上资源。
