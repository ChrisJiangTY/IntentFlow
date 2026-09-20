# IntentFlow 输入输出逻辑地图：Agent 循环与命令

普通消息进入 Agent inbox 后，模型请求由系统提示区段、工具 schema 和事件日志的历史 surface 投影组成。斜杠命令先执行 handler：有的只修改状态或权限，有的才会把消息送入 inbox；命令事件本身不直接进入主模型的对话历史。工具结果和历史 surface 在需要继续的下一次请求中使用；图中为了减少回环交叉线，没有画出它们到请求组装节点的返回箭头。虚线表示策略影响或可选委托。

```mermaid
flowchart TB
  chat["普通对话<br/>用户文本与附件"]
  notebook["Notebook / goal<br/>后续消息"]
  slash["斜杠命令<br/>/plan /goal /permission /compact"]

  slash --> command["commands.execute<br/>执行 handler；run / done 仅留日志<br/>/compact 可调用辅助模型"]
  chat --> inbox["Agent inbox<br/>输入记为 user/message"]
  notebook --> inbox
  command -->|仅某些命令入队| inbox
  inbox --> request["preStep + buildRequest<br/>系统提示区段 + 工具 schema<br/>+ 既有对话的 surface 投影"]
  command -.->|plan 改提示区段| request
  request --> model["主模型流式生成"]
  model -->|普通回复| answer["assistant/message<br/>用户可见答复"]
  model -->|tool calls| tools["工具调度<br/>受限并发，结果有序"]
  command -.->|permission 约束执行| tools
  tools -->|可能修改| work["工作区 / 外部效果"]
  tools -->|常规调用| result["tool/result<br/>后续 step 可读取"]
  tools -.->|可选委托| child["独立子 Agent<br/>只返回委托结果"]
  child --> result
  answer --> log["Session 事件日志<br/>还包含命令、状态和原始流事件"]
  result --> log
  log --> surface["下一次请求的历史 surface<br/>只取 user/message · assistant/message · tool/result"]
  log --> ui["UI / Notebook / 统计"]

  classDef input fill:#e7f2ff,stroke:#3773a8,color:#142d45,stroke-width:1.5px
  classDef process fill:#e8f5ec,stroke:#397655,color:#193e2c,stroke-width:1.5px
  classDef storage fill:#fff3db,stroke:#a97724,color:#51370d,stroke-width:1.5px
  classDef child fill:#f2eafe,stroke:#8055a5,color:#352349,stroke-width:1.5px
  class chat,notebook,slash input
  class command,inbox,request,model,tools process
  class answer,result,work,log,surface,ui storage
  class child child
```

代码入口：`packages/core/agent-loop/src/agent.ts`、`packages/core/session/src/surface.ts`、`packages/interaction/commands/src/index.ts`、`packages/plan/plan-mode/src/index.ts`。
