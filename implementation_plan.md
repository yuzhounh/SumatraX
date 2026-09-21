# Minimal SumatraPDF Viewer — Implementation Plan

## 1. 项目目标

基于 SumatraPDF 源码维护一个个人使用的极简 PDF Viewer 分支。

核心原则：

- 保留 SumatraPDF 成熟的 PDF 渲染、文本选择、搜索、滚动、缩放、打印等底层能力。
- 不重写 PDF 引擎，不修改 MuPDF 核心。
- 优先在 UI / 窗口管理层做小范围修改。
- 对“不需要的功能”优先采用“隐藏 / 禁用”，而不是删除底层实现。
- 尽量保持 patch 小、模块边界清晰，便于后续同步 SumatraPDF upstream。
- 第一版只实现当前已经明确的需求，后续根据实际使用逐步迭代。

---

## 2. 第一版功能范围

### 2.1 新窗口保持相同位置和尺寸

当前行为：

- `UseTabs = false` 时，每个 PDF 使用独立窗口。
- 第一个窗口被拖到屏幕左半边后，后续打开的新窗口会发生级联偏移。
- 偏移后右侧滚动条可能超出当前理想位置，必须再次手工调整。

目标行为：

1. 第一个 SumatraPDF 窗口仍使用正常的默认 / 已保存窗口位置。
2. 后续打开 PDF 时创建新的独立窗口。
3. 新窗口直接继承最近一个 SumatraPDF 主窗口的：
   - `x`
   - `y`
   - `width`
   - `height`
4. 新窗口显示在前台并获得焦点。
5. 不设置 `TOPMOST`。
6. 如果用户手动移动或调整当前窗口，下一次打开的 PDF 应使用新的当前位置和尺寸。
7. 多显示器环境下，应尽量继承当前窗口所在显示器的位置，不强制回到主显示器。
8. Session Restore 逻辑尽量保持原样，不因这一功能破坏已有会话恢复。

预期效果：

```text
PDF A
PDF B
PDF C
PDF D
```

四个窗口的矩形区域一致，而不是：

```text
PDF A
  PDF B
    PDF C
      PDF D
```

---

### 2.2 菜单栏默认隐藏

目标：

- 默认不显示传统菜单栏。
- 保留底层菜单命令和快捷键功能。
- 不删除菜单相关实现。

建议：

```text
ShowMenubar = false
```

实现原则：

- 优先复用 SumatraPDF 已有的菜单栏显示设置。
- 不对 `Menu.cpp` 做大规模删除。
- 后续如需临时调用某些功能，可以通过快捷键、命令面板或恢复菜单栏完成。

---

### 2.3 极简工具栏

第一版工具栏只保留：

- 当前页码输入 / 显示
- 总页数
- 左旋转
- 右旋转
- 查找

建议布局：

```text
[ 1 ] / 15        ↶    ↷        🔍
```

删除的是“显示”，而不是底层命令。

不在第一版工具栏显示：

- 打开文件
- 打印
- 上一页 / 下一页
- 缩放
- 适应页面
- 收藏夹
- 批注
- 朗读
- 其他高级功能

这些命令可以继续通过：

- 快捷键
- Command Palette
- 后续自定义入口

调用。

主要关注文件：

```text
src/Toolbar.cpp
src/Toolbar.h
```

重点定位：

```cpp
static ToolbarButtonInfo gToolbarButtons[]
```

优先通过精简可见按钮定义实现，而不是删除对应 command。

---

### 2.4 调整工具栏高度和视觉尺寸

当前问题：

- 默认工具栏偏矮。
- 按钮与页码区域显得偏小。

第一版目标：

- 工具栏整体视觉尺寸增大约 20%～30%。
- 同时调整：
  - 工具栏高度
  - 上下 padding
  - 按钮点击区域
  - 图标尺寸或图标视觉占比
  - 页码输入框高度
- 保持 DPI-aware。

主要关注文件：

```text
src/Toolbar.cpp
```

现有相关逻辑包括类似：

```cpp
static int ToolbarCyPad()
```

实现时避免简单写死固定像素，应继续使用现有：

```cpp
DpiScale(...)
```

机制。

目标是：

- 1080p 下明显比当前更舒适。
- 125%、150%、200% Windows 缩放下布局不破坏。
- 不出现图标过小但工具栏空白过大的情况。

---

### 2.5 PDF 阅读区域右键菜单禁用

当前目标：

- PDF 页面阅读区域右键不弹出菜单。
- 第一版直接禁用主要文档区右键菜单。

主要关注：

```text
src/Menu.cpp
src/Menu.h
```

相关入口：

```cpp
OnWindowContextMenu(...)
```

建议实现方式：

不要删除整个 context menu 系统，而是增加条件：

```cpp
if (gSettings->minimalViewer) {
    return;
}
```

或独立设置：

```text
ContextMenu = false
```

原因：

- 后续可能仍会需要：
  - 复制文字
  - 复制图片
  - 打开链接
  - 文档属性
- 保留底层实现便于随时恢复。

第一版只要求：

```text
PDF Canvas 右键 -> 无菜单
```

不强制处理：

- 首页右键菜单
- 书签树右键菜单
- 标签页右键菜单

因为第一版计划关闭标签页，并以纯 PDF Viewer 为核心。

---

## 3. 建议的配置设计

建议不要在代码里分散多个硬编码判断，而是增加一个统一的个人模式：

```text
MinimalViewer = true
```

第一版可由该模式控制：

```text
MinimalViewer = true

UseTabs = false
ShowMenubar = false
NewWindowSamePosition = true
MinimalToolbar = true
ContextMenu = false
ToolbarScale = 1.25
```

实际实现可以分两阶段。

### 阶段 A：快速版本

先直接实现固定行为：

- 菜单栏隐藏
- 工具栏精简
- 工具栏放大
- 右键禁用
- 新窗口继承位置

目标是尽快得到可以日常使用的版本。

### 阶段 B：参数化

确认使用体验稳定后，再把个人修改整理成设置项：

```text
MinimalViewer
NewWindowSamePosition
ToolbarScale
ContextMenu
```

避免第一版为了配置系统投入过多时间。

---

## 4. 推荐源码修改范围

目标是尽量限制在以下文件：

```text
src/SumatraPDF.cpp
src/MainWindow.cpp
src/MainWindow.h
src/Toolbar.cpp
src/Toolbar.h
src/Menu.cpp
src/Menu.h
src/Settings.h
src/AppSettings.cpp
cmd/gen-settings.ts
```

实际应以当前 master 源码为准。

第一版预计主要修改：

### 窗口管理

重点搜索：

```text
CreateAndShowMainWindow
CreateMainWindow
ShowMainWindow
GetDefaultWindowPos
windowPos
gWindows
```

目标：

- 找到新建独立主窗口时决定初始 `Rect` 的位置。
- 当已有主窗口存在时，读取最近活动 / 最近创建窗口的真实窗口矩形。
- 用该矩形初始化新窗口。

建议优先复用：

```text
HwndWindowRect(...)
SetWindowPos(...)
ShiftRectToWorkArea(...)
EnsureAreaVisibility(...)
```

不要重复写 Win32 几何辅助函数。

---

### 工具栏

重点搜索：

```text
gToolbarButtons
ToolbarButtonInfo
ToolbarCyPad
ToolbarUpdateStateForWindow
```

目标：

- 精简按钮列表。
- 保留页码、旋转、搜索。
- 调整尺寸。
- 不改 command ID。

---

### 查找

优先保留当前实现。

相关：

```text
src/FindBar.cpp
```

原则：

- `Ctrl + F` 保持工作。
- 工具栏搜索按钮继续触发现有 FindBar。
- 不重新实现搜索 UI。

---

### 菜单

主要保持已有能力，只做隐藏。

相关：

```text
src/Menu.cpp
ShowMenubar
CmdToggleMenuBar
```

第一版不删除菜单定义。

---

### Context Menu

重点：

```text
OnWindowContextMenu(...)
```

第一版只屏蔽 PDF Canvas 的主右键菜单。

---

## 5. 窗口位置功能实现细节

### 5.1 首选策略

创建新主窗口前：

1. 检查是否已有有效的 SumatraPDF 主窗口。
2. 找到最近活动窗口。
3. 读取窗口的 normal rect。
4. 新窗口使用同样的 rect。
5. 创建并正常显示。
6. 保持默认 Z-order 行为。

伪代码：

```cpp
Rect GetNewViewerWindowRect() {
    MainWindow* source = FindMostRecentMainWindow();

    if (source && IsWindow(source->hwndFrame)) {
        return HwndWindowRect(source->hwndFrame);
    }

    return GetDefaultWindowPos();
}
```

注意：

- 如果源窗口最大化，不应简单读取最大化后的全屏矩形作为普通窗口矩形。
- 优先考虑 `WINDOWPLACEMENT.rcNormalPosition`。
- 如果窗口处于普通状态，则当前 `HwndWindowRect()` 即可。
- 如果窗口被拖到第二显示器，继承该显示器位置。
- 最后仍可通过 `ShiftRectToWorkArea()` 做安全边界修正。

---

### 5.2 活动窗口选择

优先级建议：

1. 当前前台 SumatraPDF 主窗口。
2. 最近创建 / 最近使用窗口。
3. `gWindows` 中最后一个有效窗口。
4. 无可用窗口时使用默认值。

避免固定使用：

```cpp
gWindows[0]
```

否则当多个窗口存在时，用户移动的是最近窗口，但新窗口仍可能复制最旧窗口。

---

## 6. 工具栏第一版设计

建议最终视觉布局：

```text
┌─────────────────────────────────────┐
│   1 / 15            ↶   ↷     🔍   │
└─────────────────────────────────────┘
```

推荐交互：

### 页码

- 当前页：可编辑。
- Enter 跳转。
- `/ 总页数` 只读。
- 保留原 SumatraPDF 已有页码机制。

### 旋转

保留：

```text
Rotate Left
Rotate Right
```

暂不增加：

- Reset Rotation
- 自定义角度

### 查找

保留：

```text
Search
```

点击后调用现有 FindBar。

### 不保留额外分隔符

工具栏尽量压缩到真正必要内容。

---

## 7. 快捷键保留策略

即使 UI 极简，也应保留常用快捷键：

```text
Ctrl + O    打开文件
Ctrl + F    查找
Ctrl + P    打印
Ctrl + W    关闭当前窗口
Ctrl + +    放大
Ctrl + -    缩小
Home / End
PageUp / PageDown
```

具体以 SumatraPDF 当前默认快捷键为准。

原则：

> UI 可以极简，但底层能力不要主动阉割。

---

## 8. 第一版不做的事情

为控制修改范围，以下暂不做：

- 不重写 PDF 渲染。
- 不替换 MuPDF。
- 不重构整个 SumatraPDF UI。
- 不删除 Annotation 代码。
- 不删除打印代码。
- 不删除书签 / TOC。
- 不删除 Command Palette。
- 不删除菜单实现。
- 不修改 PDF 文件格式支持。
- 不做插件系统。
- 不做自定义皮肤框架。
- 不做复杂配置页面。
- 不做云同步。
- 不做自动升级机制改造。

---

## 9. 开发顺序

### Step 1：建立 fork 和可重复构建环境

目标：

- fork SumatraPDF。
- clone 本地仓库。
- 确认当前 master 可以无修改编译。
- 保存一个 clean baseline build。

验收：

```text
原版源码 -> 本地成功生成 exe -> 可正常打开 PDF
```

建议创建分支：

```text
minimal-viewer
```

---

### Step 2：窗口位置继承

实现：

```text
New window -> same rect as current Sumatra window
```

单独 commit：

```text
feat: preserve position for new document windows
```

验收：

1. 打开 A.pdf。
2. 拖到屏幕左半边。
3. 打开 B.pdf。
4. B 与 A 完全重合。
5. 移动 B。
6. 打开 C。
7. C 与 B 完全重合。

同时测试：

- 最大化窗口
- 双显示器
- Windows 125% DPI
- 连续打开 10 个 PDF

---

### Step 3：隐藏菜单栏

尽量只改默认配置。

单独 commit：

```text
ui: hide menubar in minimal viewer
```

验收：

- 启动后不显示菜单。
- PDF 渲染区域正常。
- Ctrl+O / Ctrl+F 等快捷键继续工作。

---

### Step 4：精简工具栏

只保留：

```text
Page
Rotate Left
Rotate Right
Find
```

单独 commit：

```text
ui: simplify toolbar for viewer workflow
```

验收：

- 页码跳转正常。
- 总页数正常。
- 左右旋转正常。
- 查找按钮正常。
- 切换不同 PDF 不错位。

---

### Step 5：放大工具栏

建议先从：

```text
1.20x
```

开始。

如果仍偏小，再试：

```text
1.25x
```

不要第一版直接做得过高。

单独 commit：

```text
ui: increase toolbar sizing
```

验收：

- 100% DPI
- 125% DPI
- 150% DPI
- 200% DPI

均无控件裁切。

---

### Step 6：禁用 PDF Canvas 右键菜单

单独 commit：

```text
ui: disable document context menu
```

验收：

- PDF 页面右键无弹出菜单。
- 左键选择文字正常。
- 滚轮正常。
- 拖动正常。
- Ctrl+C 等键盘操作不受影响。

---

### Step 7：整理成 MinimalViewer 模式

等前面功能稳定后，再考虑：

```text
MinimalViewer = true
```

统一管理个人定制逻辑。

单独 commit：

```text
refactor: group custom viewer behavior under minimal viewer mode
```

---

## 10. 测试清单

### 窗口

- [ ] 第一窗口使用合理默认位置
- [ ] 第二窗口与第一窗口完全重合
- [ ] 第三窗口继承第二窗口新位置
- [ ] 连续打开 10 个 PDF 不发生级联偏移
- [ ] 关闭其中部分窗口后继续打开仍正常
- [ ] 最大化状态行为合理
- [ ] 双屏正常
- [ ] DPI 缩放正常

### 菜单

- [ ] 默认隐藏
- [ ] 不影响快捷键
- [ ] 不影响文件打开
- [ ] 不影响查找

### 工具栏

- [ ] 只有预期控件
- [ ] 页码可输入
- [ ] 页数正确
- [ ] 左旋正常
- [ ] 右旋正常
- [ ] 查找正常
- [ ] 控件无裁切
- [ ] 不同 DPI 下正常

### 右键

- [ ] PDF 页面不弹菜单
- [ ] 文本选择不受影响
- [ ] 链接点击不受影响
- [ ] 滚轮缩放 / 滚动正常

### PDF 基础能力

- [ ] 普通 PDF
- [ ] 长文 PDF
- [ ] 带书签 PDF
- [ ] 扫描 PDF
- [ ] 横向 PDF
- [ ] 加密 PDF
- [ ] 大文件 PDF

---

## 11. Upstream 同步策略

个人 fork 最大风险不是功能实现，而是后续升级维护。

原则：

### 每个功能一个独立 commit

例如：

```text
feat: preserve position for new document windows
ui: hide menubar in minimal viewer
ui: simplify toolbar for viewer workflow
ui: increase toolbar sizing
ui: disable document context menu
```

不要把所有修改压成一个巨大 commit。

### 避免修改 MuPDF

尽量只改：

```text
src/
cmd/gen-settings.ts
```

不碰：

```text
ext/mupdf/
```

### 定期同步 upstream

建议：

```text
upstream/master
    ↓
rebase minimal-viewer
```

如果个人 patch 足够小，冲突通常容易处理。

---

## 12. 版本规划

### v0.1 — Minimal Viewer

包含：

- 同位置打开新窗口
- 默认隐藏菜单栏
- 极简工具栏
- 工具栏适度放大
- 禁用 PDF 页面右键

这是第一个真正投入日常使用的版本。

---

### v0.2 — 使用反馈优化

根据 1～2 周实际使用决定是否加入：

- Fit Width
- 100% Zoom
- 打开所在文件夹
- 复制当前文件路径
- Dark Reading
- 临时恢复右键菜单
- 临时恢复菜单栏
- 更精细的工具栏比例

只增加实际频繁需要的功能。

---

### v0.3 — 配置化

如果长期使用稳定，再考虑：

```text
MinimalViewer
ToolbarScale
ContextMenu
NewWindowSamePosition
```

使个人修改不再依赖硬编码。

---

## 13. 设计原则总结

这个项目不是重新开发 PDF 阅读器，而是：

```text
SumatraPDF
    +
极小 UI 定制层
    =
个人极简 PDF Viewer
```

最重要的原则：

1. 不碰 PDF 渲染核心。
2. 不删除成熟功能，只隐藏不需要的入口。
3. 所有个人修改尽量小而独立。
4. 首先满足日常阅读体验。
5. 新需求只有在实际使用中反复出现时才加入。
6. 始终保持可以低成本同步 SumatraPDF upstream。

最终目标不是“功能最少”，而是：

> 在保留 SumatraPDF 稳定性和性能的基础上，得到一个完全符合个人阅读工作流、几乎没有多余 UI 的轻量 PDF Viewer。
