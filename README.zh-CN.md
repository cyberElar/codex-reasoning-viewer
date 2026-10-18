# Codex Reasoning Viewer

[English](README.md)

在 Windows 版 Codex 桌面端的输入框上方显示完整思考摘要或可读原文，支持流式更新、
自动滚动和按回合翻阅历史。

这是一个**实验性的非官方辅助程序**，依赖经过校验的桌面版内部接口。
思考数据仍由原生适配器接收；可选插件提供 MCP 控制和斜杠菜单入口。
它不修改 Codex 安装包、ASAR、程序目录、权限、目录链接或模型配置。

## 功能

- **自动 / 摘要 / 原文**：逐段优先显示完整 summary，没有时回退到可读原文，
  也可以固定选择来源。
- **流式与滚动跟随**：接收文本增量；手动向上滚动会暂停跟随，也可通过 MCP 调整跟随偏好。
- **回合历史**：同一 turn 中的多段思考按顺序合并；新段出现时保留旧段，
  查看旧 turn 时不会强行跳回最新。
- **调整高度**：沿顶部边缘向下拖动可缩到“一行顶栏＋一行思考”，继续缩小则变成
  “指示灯＋一行思考”，隐藏状态文字和历史导航；拉高恢复，双击恢复默认高度。
  拖拽区域不显示横条，也不额外占一行。
- **精简英文顶栏**：只显示主题色指示灯、`Thinking` / `Done` 和右侧 `‹ n/m turns ›`，
  左右箭头或回合选择器仍可翻历史；翻看历史时，指示灯和文字仍显示当前回合状态。
  指示灯默认跟随 Codex 强调色。
- **MCP 设置**：显示来源、滚动跟随、折叠、高度和指示灯颜色由 MCP 工具或启动配置管理。
- **显示开关**：`/cot`、`/cot on`、`/cot off`。关闭后完全移除界面，
  不留按钮或占位，后台继续接收并保留历史；用 `/cot on` 重新打开。
- **后台启动**：可创建桌面和开始菜单入口，随 Codex 一起隐藏启动辅助程序，
  重复打开只激活已有窗口。
- **更新保护**：版本或关键资源指纹不匹配时，正常打开 Codex 并停用附加功能。

查看器只能显示 Codex 实际收到的可读文本。只有加密推理、没有可读摘要的回合仍会显示
空状态；本项目不会解密、生成缺失思考或额外请求模型。

## 环境与兼容性

- Windows 11。
- Node.js 24 或更新版本；本地验证使用 24.15.0。
- 已安装 Windows `OpenAI.Codex` 包，且版本与资源指纹通过校验。

| 版本字段            | 已验证值         |
| ------------------- | ---------------- |
| Windows MSIX 包版本 | `26.1013.4894.0` |
| ASAR 内应用版本     | `26.1013.40934`  |

两个版本字段不同。实际校验应用版本和三个 renderer 资源的 SHA-256，
见 [`supported-builds.json`](src/native/supported-builds.json)。
尚未验证其他操作系统或桌面版本。未来更新可能需要重新适配查看器。

## 安装与启动

把仓库放在准备长期保留的文件夹：

```powershell
git clone https://github.com/cyberElar/codex-reasoning-viewer.git
Set-Location .\codex-reasoning-viewer
npm.cmd ci
npm.cmd run shortcuts:install
```

安装器在用户桌面和开始菜单中创建 `Codex` 快捷方式；同名无关入口不会被覆盖，
名称冲突时会采用带后缀的名称。入口引用这个项目目录和 Node 可执行文件，
移动目录或更换 Node 安装位置后，需要重新生成入口。

如果 Codex 已经从普通官方入口启动，请等任务完成后正常退出一次，
再通过**新创建的入口**打开。以后从新入口打开时，辅助程序会在后台隐藏运行，
并随 Codex 进程结束。加载器不会为了接入而关闭已有桌面进程。

也可双击 `Launch Codex.vbs` 隐藏启动，或在终端运行：

```powershell
npm.cmd start
```

`Launch Native Viewer.cmd` 是保留终端输出的排错入口。

**自动加载仅覆盖新入口。** 从官方应用入口或之前固定的官方图标冷启动，
仍会绕过加载器。本项目不添加 Windows 登录启动任务，也不接管所有官方启动路径。
所需的临时调试入口必须在 Codex 启动时开启。

## 使用

打开含有思考记录的本地对话后，思考栏会出现在该对话输入框上方。

| 操作                | 作用                          |
| ------------------- | ----------------------------- |
| `/cot`              | 切换显示与隐藏                |
| `/cot on`           | 显示思考栏                    |
| `/cot off`          | 隐藏界面，后台继续接收历史    |
| `‹ n/m turns ›`     | 箭头或选择器按 turn 查看历史  |
| 选择最后一个回合    | 返回最新回合                  |
| `viewer_configure`  | 通过 MCP 调整来源、跟随等设置 |
| 拖动顶部横线 / 双击 | 调整高度 / 恢复默认           |

本地指令单独占一行、光标置于末尾时，按 Tab 或 Enter 就会立即执行并清空指令，
不会产生聊天消息或启动模型回合。基础加载器处理手输指令，可选插件添加原生 skill 菜单入口。
还支持 `show`、`hide`、`toggle` 别名；`/cot` 参数无效时会保留草稿并提示用法。

自动模式逐段选择来源，再将同一回合的所有思考段合并。文本不按字符数裁剪。
历史来自 Codex 已加载的缓存和查看器运行期间收到的通知；桌面加载更早的分页记录后，
查看器也会加入这些记录。它不会主动读取全部会话或另存一份推理正文。

## 可选 MCP 控制与原生斜杠菜单

```powershell
npm.cmd run plugin:install
```

安装器通过官方 Codex CLI 安装本地插件，提供 `cot`、`cot-on`、`cot-off` 三个 skill
菜单入口，以及 `viewer_show`、`viewer_hide`、`viewer_toggle`、`viewer_status`、
`viewer_settings`、`viewer_configure` 六个 MCP 工具。MCP 只返回开关状态和显示设置，
不传输思考正文。

例如 `viewer_configure` 接收 `{"mode":"raw","indicatorColor":"auto"}`，即可显示原文并让
指示灯跟随 Codex 强调色；`{"indicatorColor":"#a67df2"}` 则固定颜色。没有提供的字段保留
已保存的值。启动时会读取 MCP `env` 的 `CODEX_REASONING_*` 配置，详情和示例见
[配置说明](docs/CONTROL-PLUGIN.md#settings-and-startup-configuration)。

在受支持且已挂载查看器的桌面里，本地处理器核对本插件 skill 的精确路径，
高亮 `cot`、`cot-on` 或 `cot-off` 后，按 Tab、Enter 或点击候选项就会立即生效，
不需要发送消息。如果原生键盘处理器先插入了 skill 标记，本地处理器也会在同一次按键内
执行并清除它，不需要再按一次 Enter。
其他 skill、混合文本和附件照常处理。在没有挂载处理器的客户端调用 skill，
则走正常的模型调用工具流程。

**自动启动仍需保留项目入口。** MCP 随会话初始化时启动，晚于 Chromium 初始化，
不能给已运行的桌面补开调试端口。本插件不安装应用启动钩子；
原有后台继续负责接收、渲染和历史。

本机路径只写入被忽略的 `.local/control-plugin/`。安装或更新后，如果当前会话的
菜单缓存尚未刷新，可在新对话或下次正常重开后使用。
详见 [CONTROL-PLUGIN.md](docs/CONTROL-PLUGIN.md)。

只移除可选控制插件：`npm.cmd run plugin:remove`。

## 数据、更新与卸载

推理正文保留在 renderer 内存中；高度和显示开关保存在查看器自己的 localStorage 键中。
`.local/` 保存状态、快捷方式清单、复制的图标和测试报告，可能包含本机路径及会话 ID，
已通过 `.gitignore` 排除。

加载器通过 Windows 正式的包激活通道启动，保留更新器需要的包身份；
临时开启随机的 `127.0.0.1` CDP 端口，并核对端口归属。传给 Chromium 的是明确的非零端口，
避免端口 `0` 给普通窗口附加自动化状态。CDP 可以控制 renderer，
有权访问端口的本地程序也可能使用它，因此请保留本地访问边界，不要转发或暴露端口。
端口随本次 Codex 进程退出关闭。

未来 Codex 版本无法通过校验时，附加功能会停用，官方程序仍正常启动。
无需撤销安装包补丁或目录链接；功能恢复需要针对新版确认内部接口。

移除项目创建的入口：

```powershell
npm.cmd run shortcuts:remove
```

正常退出 Codex 后，用原来的官方入口即可普通启动，随后可以删除项目目录。
移除工具只删除仍然指向本项目的快捷方式。

## 开发

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run format:check
npm.cmd test
```

自动测试使用合成 ASAR、固定文本流和假激活回调，不需要安装 Codex，
不读取个人会话，也不向外部模型请求内容。Windows CI 使用 Node.js 24。

开发说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，
技术结构见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)，
运行细节见 [NATIVE-VIEWER.md](docs/NATIVE-VIEWER.md)。

## 许可证

[MIT](LICENSE)。本项目与 OpenAI 无关联，也未获得其背书。
仓库不分发 Codex 二进制、提取的应用 bundle、用户会话或凭证。
