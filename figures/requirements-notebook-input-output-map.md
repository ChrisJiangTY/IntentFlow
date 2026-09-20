# IntentFlow 输入输出逻辑地图：需求 Notebook 到 Tasks

需求分析、生成任务和运行全部任务由不同的触发动作启动。`T` 是任务总数（含 Final Test），`C` 是 checkpoint 数量；图中的次数表示逻辑调用数量，不等于实际模型请求数，因为每个 Agent turn 仍可包含多个 step 或重试。子 Agent 有独立会话，其产出通过工具结果或审查结论返回；文档、任务清单和审查状态记录在 Session 中，不自动作为原始事件直接进入主模型历史。

```mermaid
sequenceDiagram
  autonumber
  actor user as 用户
  participant ui as Notebook
  participant agent as 主 Agent
  participant session as Session
  participant translate as 翻译子 Agent
  participant reviewer as Reviewer 子 Agent
  participant work as 工作区

  user->>ui: 输入原始需求
  ui->>session: startRound：记录需求原文
  ui->>agent: 排队分析消息（主 turn ①）
  agent->>session: submit_requirements_document：文档与图
  session-->>ui: 显示需求文档和图结构
  user->>ui: 可编辑文档（不触发模型）
  user->>ui: 显式 Generate Tasks
  ui->>agent: 排队任务规划（主 turn ②）
  loop 每个 Task（共 T 个，含 Final Test）
    agent->>translate: submit_requirement_tasks 内顺序翻译
    translate-->>agent: 返回任务正文（当前多为回显）
  end
  agent->>session: 持久化任务清单
  session-->>ui: 展示 Tasks
  user->>ui: 显式 Run All
  loop 按顺序执行 T 个 Tasks
    ui->>agent: 当前 Task：一个主 Agent turn
    agent->>work: 执行工具并生成工作区结果
    opt checkpoint 或 Final Test（合计 C + 1 次）
      agent->>reviewer: 独立 Reviewer 子 Agent 审查
      reviewer-->>agent: 审查结论
    end
    agent->>session: 记录当前 Task 进度
  end
  agent->>session: Final Test 通过才记录最终验证
  session-->>ui: 展示验证状态与任务结果
```

代码入口：`packages/session/session-requirements/src/index.ts`。
