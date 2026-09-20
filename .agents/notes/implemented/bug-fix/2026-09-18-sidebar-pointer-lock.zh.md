# Agent Note: 侧栏预览鼠标锁定

Status: implemented

[English](2026-09-18-sidebar-pointer-lock.md) | 中文

## Problem

侧栏 HTML 预览的 iframe 沙箱缺少 `allow-pointer-lock`，因此拒绝游戏在点击后捕获鼠标。重复点击不能补齐缺少的权限。

## Decision

针对 `dsh-better-sidebar` 0.17.1 的 pnpm 补丁为 HTML 预览和浏览器 iframe 策略、HTML 响应的 CSP 沙箱添加 `allow-pointer-lock`。iframe 和响应策略都必须允许捕获。补丁包含源代码、发布的浏览器分片和声明字面量，重新安装固定版本依赖后仍保留此行为。其他沙箱标记保持不变。游戏仍须通过用户手势请求捕获，浏览器保留退出手势。

## Alternatives considered

**禁用预览沙箱。** 予以放弃，因为捕获鼠标不需要赋予预览代码访问父应用同源数据的权限。

**在游戏中重试。** 予以放弃，因为游戏代码不能赋予 iframe 缺少的沙箱权限。

## Consequences

游戏可以在点击后捕获鼠标移动，无需解锁预览。升级侧栏版本时需要复核依赖补丁。此前没有活跃决策记录负责此项权限。

## Testing

Web 浏览器测试通过已安装的侧栏打开 HTML 文件，验证真实鼠标捕获和父文档隔离，再移除权限并重新加载以复现拒绝。
