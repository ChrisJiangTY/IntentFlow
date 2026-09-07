# Agent Note: IntentFlow 产品呈现

Status: implemented

[English](2026-09-07-intentflow-product-presentation.md) | 中文

## Problem

即使部署的产品是 IntentFlow，浏览器应用仍继承 DeepSeek Harness 的产品文案。DSH 本地构建标签、与产品无关的探索口号和面向 Harness 的首次运行声明让产品身份不一致，也没有说明从需求到实现的工作流。

## Decision

Web 产品界面统一以 IntentFlow 作为应用身份。初始与响应式文档标题使用 `IntentFlow Local Build`；安装清单的完整名称和简称都使用 `IntentFlow`；本地化侧栏回退名称使用 `IntentFlow Local Build` 或 `IntentFlow 本地构建`。

空会话首屏用 `Turn intent into working software` 和 `让意图自然流向实现` 描述产品结果。版本化首次运行欢迎页明确展示 IntentFlow，说明它把澄清后的需求转化为可执行任务和可运行的软件，并引导用户选择 Workspace、配置模型提供方，再描述期望结果。文案修订会提升确认版本，因此接受过旧声明的安装只会再看到一次新的欢迎页。

技术接口保留现有名称。`dsh` 可执行文件、`DSH_*` 环境变量、包名、启动全局变量、持久数据和运行时协议文本保持不变。界面提及 DeepSeek 官方适配器或模型时，DeepSeek 继续作为提供方名称。

## Alternatives considered

**只替换侧栏标签。** 予以放弃，因为浏览器标题、安装元数据、空会话首屏和欢迎弹窗仍会呈现彼此冲突的身份。

**重命名所有 DSH 技术标识。** 予以放弃，因为这些标识是运行时和包接口，而非浏览器品牌。重命名会引入全仓协议迁移，却不会改善用户可见的 IntentFlow 体验。

**重命名 DeepSeek 提供方。** 予以放弃，因为 DeepSeek 表示真实的模型提供方，必须与 IntentFlow 产品保持可区分。

## Consequences

浏览器在两种受支持语言中呈现统一产品名和贴合工作流的承诺。已有安装会再显示一次修改后的欢迎页。源码仍会在准确表示继承技术接口的位置包含 DSH 和 DeepSeek Harness，因此文本重品牌的范围有意限定为产品呈现，而不是内部重新打包。

## Testing

本地化和组件测试固定侧栏、首屏、文档标题与欢迎文案。浏览器测试固定构建外壳、PWA 清单、首次运行流程、首屏生命周期和热重载源替换。Web 快照测试和构建后实时应用验证最终组装呈现。
