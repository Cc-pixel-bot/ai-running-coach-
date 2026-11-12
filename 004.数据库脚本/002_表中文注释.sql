-- 为已创建的新项目核心表添加中文说明，重复执行安全。
USE zhicheng_runner_v1;

ALTER TABLE app_user COMMENT = '用户账号、密码哈希与账号状态';
ALTER TABLE runner_profile COMMENT = '跑者身体数据、训练目标与基础档案';
ALTER TABLE training_plan COMMENT = '训练计划版本、目标、周期与生成状态';
ALTER TABLE course_catalog COMMENT = '训练课程目录，包含课程编号、名称和知识库内容';
ALTER TABLE workout COMMENT = '训练计划中的课程安排与训练目标';
ALTER TABLE training_record COMMENT = '单次训练执行记录及实际距离、时长和配速';
ALTER TABLE training_feedback COMMENT = '训练反馈、身体状态、疼痛信息与分析结果';
ALTER TABLE ai_workflow_run COMMENT = 'Dify 工作流调用记录、请求响应摘要与校验结果';
