# 智程 AI 跑步教练产品需求文档

版本：V1.0  
状态：产品方案  
产品定位：面向大众跑者的 AI 10km 训练教练。

## 1. 产品概述

智程根据用户的目标、身体数据、运动基础、可训练天数和健康状态，生成 8–12 周的 10km 训练计划；用户完成训练并提交反馈后，系统分析训练状态并调整后续训练。

核心原则：

1. 计划适配用户，不使用固定 8 周、固定 3 次训练等规则。
2. 所有训练课程必须来自知识库，模型不得自行创造课程。
3. 安全优先于目标成绩。
4. 反馈只影响尚未开始的后续训练，不修改历史记录。
5. Dify、后端和前端职责清晰分离。

## 2. 产品目标

- 帮助新手安全完成 10km；帮助有基础的跑者提升10km成绩。
- 按用户每周可训练天数生成可执行计划。
- 让用户明确知道每次训练做什么、强度如何判断、何时降级。
- 建立“建档—生成计划—执行—反馈—调整”的闭环。
- 保留计划版本和训练记录，保证过程可追溯。

## 3. 目标用户

### 核心用户

- 没有系统训练经验、希望完成 10km 的跑者。
- 有基础但无法独立安排训练的跑者。
- 每周训练时间有限、需要个性化频次的人群。

### 主要痛点

- 不知道每周跑几次、每次跑什么。
- 难以判断轻松跑、质量课和长距离的强度。
- 计划与个人基础、时间或身体状态不匹配。
- 训练后不知道应该维持、降负荷还是休息。

## 4. 用户主流程

登录/注册 → 跑者建档 → 选择 10km 目标 → 填写运动基础 → 设置目标成绩 → 填写身体状态 → 确认档案 → 生成计划 → 查看今日训练 → 热身 → 跑步 → 拉伸 → 训练完成 → 提交反馈 → 分析反馈 → 调整下一次训练 → 查看调整结果。

当前前端页面以 `frontend/pages/` 为准，共 19 个页面；共享样式与脚本位于 `frontend/assets/`：

1. 登录与注册
2. 跑者建档一：基础数据
3. 跑者建档二：阶段目标
4. 跑者建档三：运动基础
5. 跑者建档四：目标成绩
6. 跑者建档五：健康筛查
7. 跑者建档六：档案确认
8. AI 计划生成
9. 计划页
10. 计划总览
11. 训练页
12. 热身页
13. 跑步页
14. 拉伸页
15. 训练完成
16. 用户训练反馈
17. AI 计划调整
18. 计划前后对比
19. 我的页面

## 5. 用户输入

### 5.1 建档字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| account | string | 是 | 登录账号 |
| password | string | 是 | 登录密码 |
| height | number | 是 | 身高，cm |
| weight | number | 是 | 体重，kg |
| goal | string | 是 | V1 固定为完成 10km |
| longest_run_km | number | 是 | 最近最长一次连续跑距离 |
| latest_10k_minutes | number | 否 | 最近一次 10km 成绩 |
| train_days | integer | 是 | 每周可训练天数 |
| target_minutes | number | 否 | 10km 目标完成时间 |
| health_status | string | 是 | 身体状态和伤痛情况 |
| body_data | string/object | 否 | 用户主动提供的其他身体数据 |

系统不得从空字段推断睡眠、晨脉、疾病、心率或热量消耗。

### 5.2 训练反馈字段

- 完成情况：完成、部分完成、未完成或未说明。
- 主观疲劳：1–5 分。
- 身体状态：1–5 分。
- 疼痛程度：1–5 分。
- 是否有不适。
- 不适部位，可多选。
- 文字反馈：哪里吃力、是否提前停止、是否有疼痛。
- 实际完成距离、实际完成时长和训练日期由系统记录。

## 6. 初始计划生成

### 6.1 计划约束

- 周期为 8–12 周。
- trainDays 必须等于用户填写的 train_days。
- 每周训练数量不得超过 train_days。
- 每周至少安排 1 次 easy 或 recovery。
- 每周最多安排 2 次 quality。
- 长距离跑不能与 quality 相邻。
- L0–L1 用户不得直接安排高强度间歇。
- 课程必须来自知识库检索结果。
- 检索结果不足时降低难度或延长周期，不得编造课程。

### 6.2 检索与生成职责

后端根据结构化用户输入生成 retrieval_query，用于知识库检索。

retrieval_query 至少包含：

- goal
- level
- phase
- train_days
- type
- quality
- health_status
- 完整课程片段要求

大模型接收用户档案和知识库结果，只负责组合计划，不负责自由生成检索条件，不得绕过知识库创造课程。

### 6.3 计划 JSON

~~~json
{
  "title": "10km基础训练计划",
  "goal": "完成10公里",
  "targetMinutes": 55,
  "weeks": 8,
  "trainDays": 4,
  "summary": "基于用户基础生成的周期计划",
  "workouts": [
    {
      "week": 1,
      "day": 1,
      "type": "easy",
      "durationMin": 30,
      "distanceKm": null,
      "intensity": "RPE 3-4",
      "talkTest": "可以完整对话"
    }
  ]
}
~~~

每条 workout 至少包含 week、day、type、durationMin 或 distanceKm、intensity。课程结构、训练目的、前置条件和降级规则由知识库课程提供；只有前端确实需要展示时，才放入最终用户结果。

## 7. 训练执行

### 7.1 今日训练

用户进入计划页后看到：

- 训练名称和类型。
- 目标距离或时长。
- 强度与谈话测试。
- 进入训练按钮。
- 查看完整计划入口。

### 7.2 训练链路

训练详情 → 动态热身 → 主体跑步 → 结束跑步 → 静态拉伸 → 训练完成。

训练结束保存：

- 实际完成距离。
- 实际完成时长。
- 平均配速（可计算时）。
- 开始时间和结束时间。
- 完成状态。

### 7.3 中断与安全

- 用户提前结束时记录为 partial。
- 未开始主体训练时不得标记为 completed。
- 出现明显疼痛、头晕、胸闷等危险信号时，停止训练并建议专业评估。

## 8. 反馈分析与计划调整

### 8.1 固定分析输出

分析训练反馈的大模型只输出以下 7 行标签，不解释、不生成训练方案：

completion=completed|partial|missed|unknown  
fatigue=low|moderate|high|severe  
physical=good|normal|poor  
pain=none|mild|moderate|severe  
discomfort=true|false  
parts=部位列表或none  
action=progress|maintain|reduce|recovery|rest|medical_review

映射：

- subjective 1–2 = low，3 = moderate，4 = high，5 = severe。
- physical 1–2 = good，3 = normal，4–5 = poor。
- pain 1 = none，2 = mild，3 = moderate，4–5 = severe。
- 备注写未完成或提前停止时，completion=partial。
- 备注写未训练时，completion=missed。
- discomfort=true 或 pain>=3 时不得 progress。
- 明显疼痛或疼痛加重时，action=rest 或 medical_review。
- 信息不足时，action=maintain 或 reduce。

### 8.2 调整范围

V1 默认只调整下一次训练。原因是最近一次反馈只能直接证明用户对最近一次训练的反应；后续训练在产生新反馈后再次调整。

调整不得修改：

- 已完成训练。
- 历史反馈。
- 原始建档数据。
- 已开始的训练。
- 原计划历史版本。

### 8.3 调整规则

| 分析结果 | 默认处理 |
|---|---|
| completed + fatigue low + pain none | maintain 或小幅 progress |
| partial | reduce |
| missed | recovery 或 maintain，不自动补训 |
| fatigue high/severe | recovery 或 rest |
| pain moderate/severe | rest 或 medical_review |
| discomfort=true | 不得 progress |
| 信息不足 | maintain 或 reduce |
| Dify 调整失败 | 保留原计划，不创建新计划 |

## 9. 系统职责

### 后端

- 登录、注册和身份校验。
- 保存用户、档案、计划、训练记录和反馈。
- 生成 retrieval_query。
- 调用 Dify 工作流。
- 校验模型 JSON 和计划约束。
- 处理超时、空结果、非法格式和重复提交。
- 只有调整成功且结果合法时保存新计划版本。

### Dify

- 根据 retrieval_query 检索知识库课程。
- 使用用户档案和检索结果生成初始计划。
- 输出固定格式的训练反馈标签。
- 根据反馈标签和调整规则生成下一次训练调整结果。

### 前端

- 展示表单、计划、训练过程和反馈。
- 提交用户操作。
- 展示处理中、成功、失败和重试状态。
- 不生成课程、不暴露 Dify 密钥、不重写训练规则。

## 10. 数据对象

### RunnerProfile

account、height、weight、goal、longestRunKm、latest10kMinutes、trainDays、targetMinutes、healthStatus、bodyData、updatedAt。

### TrainingPlan

id、userId、version、status、title、goal、targetMinutes、weeks、trainDays、source、createdAt、supersededAt。

status：active、superseded、failed。

### Workout

id、planId、week、day、type、durationMin、distanceKm、intensity、talkTest、purpose、prerequisite、downgradeRule、status。

### TrainingRecord

id、workoutId、userId、status、actualDistanceKm、actualDurationMin、pace、startedAt、completedAt。

### TrainingFeedback

id、trainingRecordId、userId、completion、subjective、physical、pain、discomfort、discomfortParts、note、analysisResult、createdAt。

## 11. 异常处理

| 异常 | 系统行为 |
|---|---|
| Dify 超时 | 提示重试，原计划不变 |
| 知识库无结果 | 不编造课程，按安全降级处理 |
| 模型返回非法 JSON | 不写入新计划 |
| 重复点击生成 | 幂等处理，只创建一个结果 |
| 重复提交反馈 | 返回已有结果，不重复调整 |
| 数据库不可用 | 不显示假成功，提示保存失败 |
| 明显疼痛 | 进入休息或专业评估路径 |
| 课程不满足约束 | 后端拒绝写入并记录错误 |

## 12. 非功能需求

- Dify 密钥只允许存在后端环境变量。
- 计划生成和调整成功后才能写入 active 版本。
- 保存模型请求摘要、响应校验结果和计划版本。
- 普通接口目标响应时间小于 2 秒。
- AI 处理中必须展示明确状态。
- 移动端和桌面端均可完成主流程。
- 健康数据和训练记录只对当前用户及授权服务可见。

## 13. 产品指标

### 核心指标

- 建档完成率。
- 初始计划生成成功率。
- 计划生成平均耗时。
- 首次训练开始率。
- 首次训练完成率。
- 训练反馈提交率。
- 计划调整成功率。
- 7 日训练留存率。

### 安全指标

- 高疼痛用户被错误推进比例：0。
- 非法计划写入 active 比例：0。
- 调整失败后创建错误新计划比例：0。
- 非知识库课程进入计划比例：0。

## 14. 验收标准

### 初始计划

- 能完成登录、建档和档案确认。
- 计划周期为 8–12 周。
- 每周训练数不超过 trainDays。
- 课程全部来自知识库结果。
- 返回 JSON 合法且通过后端校验。

### 训练闭环

- 能从计划页进入今日训练。
- 能完成热身、跑步、拉伸和训练记录。
- 完成记录能关联到反馈页。
- 反馈标签能正确保存。

### 计划调整

- 反馈提交后进入调整流程。
- 调整失败时原计划保持不变。
- 调整成功时只影响后续未开始训练。
- 对比页能展示调整前后差异。

### 安全

- pain>=3 时不得 progress。
- 明显疼痛或加重时进入 rest 或 medical_review。
- 模型返回非法 JSON 时不得写入计划。

## 15. 版本规划

### V1：10km 训练闭环

登录注册、跑者建档、10km 初始计划、今日训练、完整计划、训练记录、结构化反馈和下一次训练调整。

### V1.1：稳定性

计划版本历史、失败重试、调整原因、接口日志、幂等和异常恢复。

### V2：个性化

设备数据接入、多目标训练、长期趋势、阶段总结和更细训练等级。

## 16. 当前决策记录

1. 用户档案和身体数据提供给大模型，但只有结构化 retrieval_query 用于知识库检索。
2. 后端负责生成检索标签，大模型不自由推导检索条件。
3. 知识库提供完整课程，大模型负责组合，不得编造。
4. 反馈分析先输出固定标签，再进入调整流程。
5. 调整默认只作用于下一次训练。
6. 当前 PRD 编写不修改前端页面、后端代码、数据库脚本或 Dify 流程。
