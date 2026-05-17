# Agent Engineering System Prompt（强约束版）

---

# 0. Global Principles

## MUST

- 优先使用成熟开源方案
- 所有设计必须基于行业最佳实践或开源实现
- 保持系统最小复杂度
- 保持代码可读性与可维护性

## MUST NOT

- 凭经验设计系统
- 无依据自研基础设施
- 忽略已有成熟方案

---

# 1. Open Source First

## MUST

- 所有功能必须优先调研开源实现
- 校验 / ORM / 鉴权 / 错误处理必须使用成熟库
- 不使用开源方案必须有明确理由

## MUST NOT

- 重复造轮子
- 自研已有成熟能力模块

---

# 2. Design Before Code

## MUST

- 编码前必须确认是否存在成熟方案
- 必须确认行业标准实现方式
- 必须确认是否存在可参考开源项目

## MUST NOT

- 未调研直接实现
- 凭经验设计架构

---

# 3. Abstraction & Reuse

## MUST

- 重复逻辑 ≥ 2 次必须抽象
- ≥ 3 次必须提取公共模块
- 优先级：middleware > service > util

## MUST NOT

- 复制粘贴逻辑
- 重复实现同一能力

---

# 4. Code Simplicity

## MUST

- 函数职责单一
- 嵌套层级 ≤ 3
- 优先清晰表达而非复杂技巧

## MUST NOT

- 函数 > 100 行
- 深层嵌套逻辑

---

# 5. Chinese Comments

## MUST

- 核心逻辑必须中文注释
- 必须说明 WHY 与 TRADE-OFF

## MUST NOT

- 解释代码表面行为

---

# 6. Continuous Refactoring

## MUST

- 每次修改必须优化旧代码结构
- 必须减少或不增加复杂度

## MUST NOT

- 只新增不优化
- 持续堆积逻辑

---

# 7. Decision Discipline

## MUST

- 所有设计必须有依据：
  - 开源项目
  - 官方文档
  - 行业实践

## MUST NOT

- 我觉得 / 习惯这样写
- 无依据技术选型

---

# 8. Complexity Control

## MUST

- 文件 ≤ 500 行
- 函数 ≤ 100 行
- 模块职责清晰
- 测试文件必须集中放在所属 package 的 `tests/` 目录下，并按源码/业务层级镜像组织
- 测试专用 helper 也必须放在 `tests/` 内，不得混入正常运行时代码目录

## MUST NOT

- 职责混乱模块
- 难以理解的复杂逻辑
- 在 `src/`、`lib/`、`ui/`、`tools/`、`prompts/` 等正常项目目录中新增 `*.test.*` / `*.spec.*`

---

# 9. Pre-Output Checklist

## MUST

- 使用成熟方案
- 避免重复逻辑
- 已完成抽象
- 有中文 WHY 注释
- 优化旧代码
- 有设计依据

## MUST NOT

- 任一项不满足仍继续输出

---

# 10. Hard Stop Rules

## MUST STOP IF

- 未调研直接实现
- 重复造轮子
- 未抽象重复逻辑
- 缺少关键设计注释
- 不理解既有领域状态 / progress-store / lesson-bank 的职责边界

## ACTION

- 停止代码生成
- 进入设计或重构阶段
- 先向用户确认，不要自行设计替代方案

@RTK.md
