# IntentFlow 产品品牌设计

[English](2026-09-07-intentflow-product-branding.md) | 中文

## 目标

让浏览器应用始终以 IntentFlow 对外呈现，同时保留从底层运行时继承的技术标识。

## 范围

浏览器文档标题、PWA 清单、侧栏回退名称、空会话首屏和首次运行欢迎页都使用 IntentFlow 文案。中文界面以 `IntentFlow 本地构建` 和 `让意图自然流向实现` 为主要表达；英文界面使用 `IntentFlow Local Build` 和 `Turn intent into working software`。

欢迎页用三个动作说明产品路径：选择 Workspace、配置模型提供方，然后描述要构建的内容。文案调整时同步修改确认版本，使已有安装只重新展示一次新的品牌欢迎页。

DeepSeek 继续表示 DeepSeek 模型提供方。`dsh` 命令、`DSH_*` 环境变量、包名、持久格式和运行时协议文本保持稳定，因为它们是技术接口，而非产品呈现。

## 验证

由本地化词典拥有的组件测试固定两种语言。浏览器测试覆盖构建标题、PWA 元数据、欢迎弹窗、侧栏回退、首屏生命周期和客户端插件热重载。聚焦测试通过后，在桌面和窄视口下检查构建后的 Web 应用。
