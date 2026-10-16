# 图片白闪修复与独立深色界面

更新：2026-10-16（Asia/Shanghai）。

## 当前范围

- 已实施：图片切换时的清屏、异步加载页沿用图片背景色，保留 ImageUI / ComicBookUI 和当前文档的背景覆盖；加载文字保持可读。
- 已实施：活动图片标签使用深色界面，PDF 标签恢复原来保存的主题；两个窗口分别跟随各自的活动标签。
- PDF 页面颜色、文档颜色跟随主题设置与保存的全局主题不因切换图片而改变。
- 上游基线保持不变；用户已授权升级为 Rev.2、提交、推送并发布 GitHub Release。

## 白闪原因与验证

- `src/SumatraPDF.cpp` 的 `CloseDocumentInCurrentTab()` 清屏，随后 `StartLoadDocument()` 在后台加载下一张图片。
- `src/Canvas.cpp` 的 `FillCanvasThemeBackground()` 与 `OnPaintDocumentStatus()` 原先使用全局窗口主题背景，浅色主题下为浅灰；图片正常渲染则默认为黑色。
- 修改前实际窗口回归测试捕获：下一张图片的加载过程绘制 RGB(242,242,242)，期望 RGB(0,0,0)。
- `tests/image-switch-background.ts` 检查前后图片导航期间的窗口 DC 像素与实际 WM_PAINT 输出，覆盖默认黑色和自定义图片背景。已注册到常规测试列表。
- 独立主题加入后的 Debug 图片切换测试通过。Release 验证与当前交付见下文。

## 使用行为

可以同时打开 PDF 和图片。界面外观由当前窗口的活动文档决定。

1. 同一窗口、多标签：选中图片时标签栏、标题栏、工具栏、菜单和侧栏显示深色；切回 PDF 时恢复该窗口的正常浅色主题。窗口外框为所有标签共用，任何时刻只能显示当前标签对应的一套外观。
2. 多个独立窗口：图片窗口保持深色，PDF 窗口保持原来的浅色；窗口失焦、重绘和调整尺寸不会改变另一窗口的颜色。
3. 关闭图片标签后恢复后续活动标签的外观。PDF 页面和图片像素不因界面切换而反色。

## 实施结果

- `src/Theme.cpp` 新增窗口消息范围内的临时界面主题，按窗口所属的当前文档解析颜色。成对的线程级窗口消息回调覆盖原生控件的同步和嵌套重绘，消息循环与主窗口/画布入口也保存并恢复上下文。参见 [Microsoft 窗口消息回调说明](https://learn.microsoft.com/en-us/windows/win32/winmsg/about-hooks)。
- `src/SumatraPDF.cpp` 在当前标签的界面更新入口刷新该窗口的控件、工具栏、侧栏和标题栏；不会调用全局 SetTheme，也不会为自动切换重设共享 PDF 渲染缓存。
- `ThemePageRenderColors()` 和 `UpdateDocumentColors()` 明确使用保存的文档主题，确保图片界面的临时深色不会改变 PDF 页面颜色。
- `src/DarkMode.cpp` 与 `ext/darkmodelib/` 使用两套持久的原生控件调色板、画刷和视图资源。原生菜单在显示时采用所属窗口的模式，避免系统的进程级菜单偏好让 PDF 菜单也变深。
- darkmodelib 的颜色上下文与菜单模式接口为本项目修改；以后升级该依赖时需保留这些接口及独立调色板实现。

## 验证与交付

- `tests/image-window-theme.ts` 在旧版上失败：图片标签工具栏仍为白色（shade=255）。
- 新版 Debug 测试通过：极简/完整界面、PDF 与图片反复切换、关闭图片标签、两个同进程窗口交替重绘、原生图片/PDF 菜单分别深色/浅色。
- 测试启用 `DocumentColorsFollowTheme = smart`，比较切换、关闭及另一窗口重绘前后的 PDF 页面像素哈希，结果一致。
- 已通过相关 Debug 检查：`image-switch-background`、`command-palette-theme`、`find-ui-state`。
- `home-theme-icons` 在改动前 Release 与改动后 Debug 都因旧测试写入 `SumatraPDF-settings.txt`、未使用当前 `SumatraX-settings.txt` 而返回 `ERROR not-list-view`；未计为通过，未扩展修改该无关测试。
- 最终 Release 构建通过，0 警告、0 错误。最终可执行文件通过 `image-window-theme`、`image-switch-background`、`issue-5780`、`command-palette-theme`、`find-ui-state` 和 `release-package` 检查。
- Rev.2 正式构建通过（0 警告、0 错误）；动态版与静态单文件版均通过 `image-window-theme`，动态版另通过图片白闪和 PDF 文件导航测试，发布打包测试通过。
- 已逐一核对 Rev.2 程序/DLL 的显示版本与数字修订号，并校验单文件 EXE、便携目录和 ZIP 内全部程序的一致性。
- 当前状态：Rev.2 构建与本地验证完成。GitHub 发布记录见 [v3.7.22619-r2](https://github.com/yuzhounh/SumatraX/releases/tag/v3.7.22619-r2)。

交付路径保持 `out/rel64/SumatraX.exe`，正式发布版本为 `3.7.22619 Rev.2`，标签为 `v3.7.22619-r2`。单文件 EXE 与便携 ZIP 位于 `out/release-3.7.22619-r2/`。

正式发布包 SHA-256：

- `SumatraX-v3.7.22619-r2-x64.exe`：`F02151CB8411FD87B27BABD8F13689402EFE557E09B30375AC87E629D19E6D5E`
- `SumatraX-v3.7.22619-r2-x64.zip`：`E0918F4F5B3915516D6123A221ECE9B25E70BA7397B0E013633DB45C94087332`
