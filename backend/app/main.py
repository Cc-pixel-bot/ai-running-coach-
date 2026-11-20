from __future__ import annotations

import json
import hashlib
import os
import re
import uuid
import queue
import threading
import contextvars
import math
from itertools import combinations
import http.client
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP
from pathlib import Path
from typing import Any

import jwt
import bcrypt
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "mysql+pymysql://root:root@127.0.0.1:13307/zhicheng_runner_v1?charset=utf8mb4")
JWT_SECRET = os.environ.get("JWT_SECRET", "local-development-only-change-this-secret")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 24 * 7
DIFY_API_BASE_URL = os.environ.get("DIFY_API_BASE_URL", "http://172.22.0.1/v1").rstrip("/")
DIFY_PLAN_API_KEY = os.environ.get("DIFY_PLAN_API_KEY", "")
DIFY_ADJUST_API_KEY = os.environ.get("DIFY_ADJUST_API_KEY", "")
WORKFLOW_PROGRESS = contextvars.ContextVar("workflow_progress", default=None)
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=1800)
Session = sessionmaker(bind=engine, expire_on_commit=False)
bearer = HTTPBearer(auto_error=False)
app = FastAPI(title="智程 AI 跑步教练 API", version="1.0.0")


def uid() -> str:
    return str(uuid.uuid4())


def parse_workout_day(value: Any) -> int:
    """Accept the workflow's day1 labels and numeric day values for storage."""
    if isinstance(value, bool):
        raise ValueError("invalid workout day")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        match = re.fullmatch(r"\s*(?:day\s*)?(\d+)\s*", value, re.IGNORECASE)
        if match:
            return int(match.group(1))
    raise ValueError("invalid workout day")


def schedule_with_long_quality_spacing(normalized: list[tuple[int, int, str]], raw_types_by_position: dict[tuple[int, int], str], course_keys_by_position: dict[tuple[int, int], str], weeks: int) -> dict[tuple[int, int], int] | None:
    """Move sessions to nearby calendar days when needed to separate long and quality runs.

    Session order within each week is preserved. Of valid 1–7 day assignments, choose
    the one with the smallest total day shift; return None only when no safe schedule exists.
    """
    primary_quality = {"quality", "tempo", "interval"}
    sessions_by_week: dict[int, list[tuple[int, str, str]]] = {week: [] for week in range(1, weeks + 1)}
    for week, day, kind in normalized:
        raw_type = raw_types_by_position[(week, day)].lower()
        course_key = course_keys_by_position[(week, day)]
        if course_key == "ST-4":
            raw_type = "strides"
        sessions_by_week[week].append((day, kind, raw_type))

    candidates_by_week: dict[int, list[dict[str, Any]]] = {}
    for week, sessions in sessions_by_week.items():
        sessions.sort(key=lambda session: session[0])
        candidates: list[dict[str, Any]] = []
        for new_days in combinations(range(1, 8), len(sessions)):
            assignments = [(old_day, new_day, kind, raw_type)
                           for (old_day, kind, raw_type), new_day in zip(sessions, new_days)]
            long_days = [new_day for _, new_day, kind, _ in assignments if kind == "long"]
            quality_days = [new_day for _, new_day, _, raw_type in assignments if raw_type in primary_quality]
            if any(abs(long_day - quality_day) == 1 for long_day in long_days for quality_day in quality_days):
                continue
            day_types = {new_day: ("long" if kind == "long" else "quality" if raw_type in primary_quality else "other")
                         for _, new_day, kind, raw_type in assignments}
            candidates.append({
                "assignments": assignments,
                "cost": sum(abs(old_day - new_day) for old_day, new_day, _, _ in assignments),
                "day1": day_types.get(1),
                "day7": day_types.get(7),
            })
        if not candidates:
            return None
        candidates_by_week[week] = candidates

    # Dynamic programming carries only the previous week's boundary workout state,
    # so a Day 7 long run cannot touch a Day 1 quality session (or vice versa).
    parents: dict[int, dict[int, int | None]] = {}
    costs: dict[int, dict[int, int]] = {}
    for week in range(1, weeks + 1):
        week_costs: dict[int, int] = {}
        week_parents: dict[int, int | None] = {}
        for candidate_index, candidate in enumerate(candidates_by_week[week]):
            if week == 1:
                week_costs[candidate_index] = candidate["cost"]
                week_parents[candidate_index] = None
                continue
            best: tuple[int, int] | None = None
            for previous_index, previous_cost in costs[week - 1].items():
                previous = candidates_by_week[week - 1][previous_index]
                boundary_conflict = (previous["day7"] == "long" and candidate["day1"] == "quality") or (
                    previous["day7"] == "quality" and candidate["day1"] == "long")
                if boundary_conflict:
                    continue
                total_cost = previous_cost + candidate["cost"]
                if best is None or total_cost < best[0]:
                    best = (total_cost, previous_index)
            if best is not None:
                week_costs[candidate_index], week_parents[candidate_index] = best
        if not week_costs:
            return None
        costs[week], parents[week] = week_costs, week_parents

    final_index = min(costs[weeks], key=costs[weeks].get)
    selected_by_week: dict[int, int] = {}
    for week in range(weeks, 0, -1):
        selected_by_week[week] = final_index
        parent_index = parents[week][final_index]
        if parent_index is not None:
            final_index = parent_index

    day_moves: dict[tuple[int, int], int] = {}
    for week, candidate_index in selected_by_week.items():
        for old_day, new_day, _, _ in candidates_by_week[week][candidate_index]["assignments"]:
            day_moves[(week, old_day)] = new_day
    return day_moves


def normalize_catalog_course_type(course_type: str) -> str | None:
    """Map the exact Dify category to the operational workout category."""
    return {"easy": "easy", "aerobic_base": "easy", "easy,aerobic_base": "easy",
            "run_walk": "easy", "recovery": "recovery", "long_run": "long", "long": "long",
            "quality": "quality", "strides": "quality", "tempo": "tempo", "interval": "interval",
            "other": "other"}.get(str(course_type or "").lower())


def canonical_course_key(course_key: str, title: str) -> str:
    """Resolve the three Dify long-run blocks whose metadata key conflicts with their course name."""
    corrections = {
        ("LR-50-L0", "长距离跑走（进阶 I）"): "LR-50-L1",
        ("LR-60-L0", "长距离跑走（进阶 II）"): "LR-60-L2",
        ("LR-90-L0", "长距离跑走（进阶 IV）"): "LR-90-L3",
    }
    compact_title = re.sub(r"\s+", "", title)
    for (source_key, expected_title), canonical_key in corrections.items():
        if course_key == source_key and compact_title == re.sub(r"\s+", "", expected_title):
            return canonical_key
    return course_key


def json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def parse_course_ranges(content: Any) -> tuple[float | None, float | None, str | None]:
    """Read the generic range defaults from the stored knowledge-base course block."""
    try:
        course = json_value(content) if content is not None else None
    except (TypeError, json.JSONDecodeError):
        return None, None, None
    if not isinstance(course, dict):
        return None, None, None
    body = str(course.get("body") or "")
    distance_line = re.search(r"距离范围\s*[:：]\s*([^\r\n]+)", body)
    distance_match = re.search(r"(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*km", distance_line.group(1), re.I) if distance_line else None
    distance_min = float(distance_match.group(1)) if distance_match else None
    distance_max = float(distance_match.group(2)) if distance_match else None
    pace_line = re.search(r"配速范围\s*[:：]\s*([^\r\n]+)", body)
    pace = re.sub(r"[`*_]", "", pace_line.group(1)).strip().rstrip("。 ") if pace_line else None
    return distance_min, distance_max, pace or None


def pace_intervals_seconds(value: Any) -> list[tuple[int, int]]:
    """Extract pace interval endpoints as seconds per km, preserving their order."""
    if not isinstance(value, str):
        return []
    intervals = []
    for match in re.finditer(r"(?<!\d)(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})", value):
        start = int(match.group(1)) * 60 + int(match.group(2))
        end = int(match.group(3)) * 60 + int(match.group(4))
        if start <= end:
            intervals.append((start, end))
    return intervals


def percentage_lower_load_prescription(original: dict, requested_item: dict) -> dict | None:
    """Keep the requested course identity and derive a predictable load reduction from its original values."""
    original_distance = original.get("distanceKm")
    original_pace = pace_intervals_seconds(original.get("paceRangeMinPerKm"))
    if (not isinstance(original_distance, (int, float)) or isinstance(original_distance, bool)
            or original_distance <= 0 or not original_pace):
        return None

    # Show a 10–20% shorter distance band; prescribe its midpoint (15% lower).
    distance_min = round(float(original_distance) * 0.80, 2)
    distance_max = round(float(original_distance) * 0.90, 2)
    distance = round(float(original_distance) * 0.85, 2)
    if distance_min <= 0 or not distance_min <= distance <= distance_max:
        return None

    # Pace is time per kilometer: increase each interval's lower endpoint by 5%
    # and upper endpoint by 10%, rounding up to whole seconds so it is truly slower.
    slower_intervals = []
    for start, end in original_pace:
        slower_start = math.ceil(start * 1.05)
        slower_end = math.ceil(end * 1.10)
        if slower_start <= start or slower_end <= end or slower_start > slower_end:
            return None
        slower_intervals.append((slower_start, slower_end))

    pace_range = ", ".join(
        f"{start // 60}:{start % 60:02d}–{end // 60}:{end % 60:02d} min/km"
        for start, end in slower_intervals
    )
    return {
        **requested_item,
        "distanceKm": distance,
        "distanceRangeKm": [distance_min, distance_max],
        "paceRangeMinPerKm": pace_range,
        "note": "按原计划距离减少10%–20%（本次取15%），每公里用时增加5%–10%，降低本次训练负荷。",
    }


def coach_adjustment_explanation(feedback: dict, ai_result: dict, current_plan: dict, *, force_compose: bool = False) -> str:
    """Keep legacy four-line Dify responses usable while returning the new three-line narrative."""
    supplied = str(ai_result.get("feedback_analysis") or "")
    lines = [line.strip() for line in supplied.splitlines() if line.strip()]
    if len(lines) == 3 and not force_compose:
        return "\n".join(lines)
    if len(lines) not in (3, 4):
        raise HTTPException(status_code=502, detail="Dify 调整说明必须包含三行有内容的教练说明")

    completion = {"completed": "这次训练按计划完成了", "partial": "这次训练只完成了部分",
                  "missed": "这次训练没有完成", "unknown": "这次训练完成情况还不完整"}.get(
                      str(feedback.get("completion") or "unknown"), "这次训练完成情况还不完整")
    fatigue = {1: "疲劳感较轻", 2: "疲劳不明显", 3: "疲劳中等", 4: "疲劳偏高", 5: "疲劳很重"}.get(
        int(feedback.get("subjective") or 0))
    physical = {1: "身体状态较差", 2: "身体状态不太理想", 3: "身体状态尚可", 4: "身体状态不错", 5: "身体状态很好"}.get(
        int(feedback.get("physical") or 0))
    pain_score = int(feedback.get("pain") or 0)
    pain = {1: "有轻微疼痛", 2: "有轻微疼痛", 3: "有中等程度的疼痛", 4: "有较明显的疼痛", 5: "有较明显的疼痛"}.get(pain_score)
    feedback_parts = [part for part in (fatigue, physical, pain) if part]
    feedback_line = f"{completion}{'，' + '，'.join(feedback_parts) if feedback_parts else ''}。"

    scope_targets = current_plan.get("adjustmentTargets", {}).get(ai_result.get("adjustmentScope"), [])
    before_by_day = {(int(item["week"]), parse_workout_day(item["day"])): item for item in scope_targets}
    changed_runs = []
    cancelled_count = 0
    for item in ai_result.get("planChanges") or []:
        original = before_by_day.get((int(item.get("week", 0)), parse_workout_day(item.get("day", 0))))
        if str(item.get("type") or "").lower() == "rest":
            cancelled_count += 1
            continue
        if original:
            changed_runs.append((original, item))
    if changed_runs or cancelled_count:
        parts = []
        if changed_runs:
            count_text = f"接下来{len(changed_runs)}次训练" if len(changed_runs) > 1 else "接下来这次训练"
            quality_downgraded = any(
                str(original.get("type") or "").lower() in {"tempo", "interval", "quality", "long"}
                and str(item.get("type") or "").lower() in {"easy", "recovery", "run_walk"}
                for original, item in changed_runs
            )
            if ai_result.get("status") in {"reduce", "recovery"}:
                parts.append(f"我把{count_text}整体放轻，缩短跑量并放慢节奏")
            elif ai_result.get("status") == "progress":
                parts.append(f"我结合你的状态，为{count_text}安排了循序渐进的训练提升")
            else:
                parts.append(f"我根据你的状态调整了{count_text}的内容和强度")
            if quality_downgraded and ai_result.get("status") in {"reduce", "recovery"}:
                parts.append("同时把质量训练改为轻松跑")
        if cancelled_count:
            parts.append(f"暂停{cancelled_count}次训练")
        adjustment_line = "结合你的反馈，" + "，".join(parts) + "，先给身体留出恢复空间。"
    elif ai_result.get("status") == "maintain":
        adjustment_line = "这次反馈没有触发需要调整的课程，我先按原计划继续。"
    else:
        adjustment_line = "结合这次反馈，我暂时保留后续安排，避免做出不安全的调整。"
    care_line = ("先好好恢复，疼痛加重或影响跑姿就暂停训练并求助。"
                 if pain_score else "先好好休息，不用急着补课，按状态慢慢恢复。")
    return "\n".join((feedback_line, adjustment_line, care_line))


def workout_range_values(item: dict, course_content: Any = None, *, required: bool = False) -> tuple[float | None, float | None, str | None]:
    raw_distance = item.get("distanceRangeKm")
    raw_pace = item.get("paceRangeMinPerKm")
    has_distance = raw_distance is not None
    has_pace = raw_pace is not None
    if has_distance != has_pace:
        raise HTTPException(status_code=502, detail="课程距离和配速范围必须同时提供")
    if not has_distance and not has_pace and course_content is not None and not required:
        raw_min, raw_max, raw_pace = parse_course_ranges(course_content)
    elif has_distance and has_pace:
        if (not isinstance(raw_distance, list) or len(raw_distance) != 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in raw_distance)):
            raise HTTPException(status_code=502, detail="课程 distanceRangeKm 必须是两个有限数值组成的数组")
        raw_min, raw_max = float(raw_distance[0]), float(raw_distance[1])
        if raw_min <= 0 or raw_max < raw_min:
            raise HTTPException(status_code=502, detail="课程距离范围必须为正数且按升序排列")
        if not isinstance(raw_pace, str) or not raw_pace.strip():
            raise HTTPException(status_code=502, detail="课程 paceRangeMinPerKm 必须包含具体分钟/公里区间")
        # Add the unit to every explicit pace interval when the model omitted it.
        # Preserve the model's personalized pace numbers and segment labels.
        raw_pace = re.sub(
            r"(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})(?:\s*min/km)?",
            r"\1–\2 min/km",
            raw_pace.strip(),
            flags=re.I,
        )
        if not re.search(r"\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}\s*min/km", raw_pace, re.I):
            raise HTTPException(status_code=502, detail="课程 paceRangeMinPerKm 必须包含具体分钟/公里区间")
    else:
        raw_min = raw_max = None
    # The catalog is the source of truth for a course's allowed distance range.
    # Keep requiring a well-formed range from Dify as part of its output contract,
    # but don't make a harmless model transcription error fail the whole plan.
    # Normalize to the catalog range before validating distanceKm and persisting;
    # this prevents a model from widening the range and getting an unsafe target
    # accepted merely because it fits the model's own output.
    if course_content is not None:
        catalog_min, catalog_max, catalog_pace = parse_course_ranges(course_content)
        if required and (catalog_min is None or catalog_max is None):
            raise HTTPException(status_code=502, detail="课程目录缺少可校验的距离范围")
        if catalog_min is not None and catalog_max is not None:
            raw_min, raw_max = catalog_min, catalog_max
        if catalog_pace:
            if not raw_pace:
                raw_pace = catalog_pace
            else:
                catalog_intervals = pace_intervals_seconds(catalog_pace)
                requested_intervals = pace_intervals_seconds(raw_pace)
                if requested_intervals and catalog_intervals and any(
                    not any(allowed_start <= start and end <= allowed_end
                            for allowed_start, allowed_end in catalog_intervals)
                    for start, end in requested_intervals
                ):
                    raise HTTPException(status_code=502, detail="课程配速区间超出知识库课程允许范围")
    if required and (raw_min is None or raw_max is None or not raw_pace):
        raise HTTPException(status_code=502, detail="Dify 计划课程必须包含具体距离和配速范围")
    return raw_min, raw_max, raw_pace


def target_distance_value(value: Any, distance_min: float | None, distance_max: float | None) -> float:
    """Normalize the AI target to a 0.5km step while enforcing the course range."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise HTTPException(status_code=502, detail="跑步课程 distanceKm 必须是具体数值")
    if distance_min is None or distance_max is None:
        raise HTTPException(status_code=502, detail="跑步课程缺少可用于校验 distanceKm 的距离范围")
    try:
        target = Decimal(str(value))
        lower, upper = Decimal(str(distance_min)), Decimal(str(distance_max))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=502, detail="跑步课程 distanceKm 格式错误")
    if target <= 0:
        raise HTTPException(status_code=502, detail="跑步课程 distanceKm 必须大于 0")
    # Expand the catalog bounds outward to the nearest 0.5 km step. This lets
    # runners use practical half-kilometer targets just outside fractional
    # catalog endpoints (e.g. 3.7–4.6 km accepts 3.5–5.0 km).
    min_step = (lower * 2).to_integral_value(rounding=ROUND_FLOOR)
    max_step = (upper * 2).to_integral_value(rounding=ROUND_CEILING)
    if min_step > max_step:
        raise HTTPException(status_code=502, detail="课程距离范围内不存在整数或 0.5 km 的可选目标")
    if target < min_step / 2 or target > max_step / 2:
        raise HTTPException(status_code=502, detail="跑步课程 distanceKm 必须位于按 0.5 km 步进扩展后的课程范围内")
    selected_step = (target * 2).to_integral_value(rounding=ROUND_HALF_UP)
    selected_step = min(max(selected_step, min_step), max_step)
    return float(selected_step / 2)


def workout_range_payload(row: Any) -> tuple[list[float] | None, str | None]:
    distance_min, distance_max = row["distance_min_km"], row["distance_max_km"]
    pace = row["pace_range_min_per_km"]
    if distance_min is not None and distance_max is not None and pace:
        if str(row["purpose"] or "").startswith("按原计划距离减少10%–20%"):
            return [float(distance_min), float(distance_max)], pace
        lower = Decimal(str(distance_min))
        upper = Decimal(str(distance_max))
        expanded_min = (lower * 2).to_integral_value(rounding=ROUND_FLOOR) / 2
        expanded_max = (upper * 2).to_integral_value(rounding=ROUND_CEILING) / 2
        return [float(expanded_min), float(expanded_max)], pace
    fallback_min, fallback_max, fallback_pace = parse_course_ranges(row["course_content"] if "course_content" in row else None)
    if distance_min is None or distance_max is None:
        distance_min, distance_max = fallback_min, fallback_max
    if not pace:
        pace = fallback_pace
    if distance_min is not None and distance_max is not None:
        expanded_min = (Decimal(str(distance_min)) * 2).to_integral_value(rounding=ROUND_FLOOR) / 2
        expanded_max = (Decimal(str(distance_max)) * 2).to_integral_value(rounding=ROUND_CEILING) / 2
        distance_range = [float(expanded_min), float(expanded_max)]
    else:
        distance_range = None
    return distance_range, pace


def token_for(user_id: str, account: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user_id, "account": account, "iat": now, "exp": now + timedelta(hours=TOKEN_TTL_HOURS)}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def password_digest(password: str) -> bytes:
    # SHA-256 pre-hashing gives bcrypt a fixed-size input and avoids its 72-byte limit.
    return hashlib.sha256(password.encode("utf-8")).digest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password_digest(password), bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password_digest(password), stored_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


class Credentials(BaseModel):
    account: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9]+$")
    password: str = Field(min_length=6, max_length=200)


class RunnerProfile(BaseModel):
    height: float = Field(ge=100, le=250)
    weight: float = Field(ge=25, le=300)
    goal: str = "完成 10 公里"
    longestRunKm: float = Field(ge=0, le=500)
    averageDailyKm: int = Field(ge=1, le=10)
    latest10kMinutes: float | None = Field(default=None, gt=0)
    trainDays: int = Field(ge=1, le=7)
    targetMinutes: float | None = Field(default=None, gt=0)
    health: list[str] = Field(default_factory=list)
    healthStatus: str = ""
    bodyData: dict[str, Any] = Field(default_factory=dict)


class RunFinish(BaseModel):
    distanceKm: float = Field(ge=0)
    durationMin: float = Field(ge=0)
    completed: bool = True


class Feedback(BaseModel):
    subjective: int = Field(ge=1, le=5)
    physical: int = Field(ge=1, le=5)
    pain: int = Field(ge=0, le=5)
    note: str = Field(default="", max_length=200)
    completion: str = "completed"


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict[str, str]:
    if not credentials:
        raise HTTPException(status_code=401, detail="请先登录")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {"id": str(payload["sub"]), "account": str(payload["account"])}
    except (jwt.PyJWTError, KeyError):
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")


def get_profile(db, user_id: str):
    row = db.execute(text("SELECT * FROM runner_profile WHERE user_id=:id"), {"id": user_id}).mappings().first()
    if not row:
        return None
    body_data = json_value(row["body_data"]) or {}
    if not isinstance(body_data, dict):
        body_data = {}
    # Runner level is calculated by the Dify RE node, not by the backend.
    # Remove any legacy value persisted by older backend versions.
    body_data.pop("level", None)
    health = body_data.get("health", [])
    profile = {
        "height": float(row["height_cm"]), "weight": float(row["weight_kg"]), "goal": "完成 10 公里",
        "longestRunKm": float(row["longest_run_km"]), "latest10kMinutes": float(row["latest_10k_minutes"]) if row["latest_10k_minutes"] is not None else None,
        "averageDailyKm": int(row["average_daily_km"]) if row["average_daily_km"] is not None else None,
        "trainDays": int(row["train_days"]), "targetMinutes": float(row["target_minutes"]) if row["target_minutes"] is not None else None,
        "health": health, "healthStatus": row["health_status"], "bodyData": body_data,
    }
    return profile


def get_active_plan(db, user_id: str):
    return db.execute(text("SELECT * FROM training_plan WHERE user_id=:uid AND status='active' ORDER BY version DESC LIMIT 1"), {"uid": user_id}).mappings().first()


def plan_explanation_for_plan(db, plan_id: str):
    """Read the optional coach explanation saved with the Dify generation run."""
    run = db.execute(text("""SELECT response_summary FROM ai_workflow_run
      WHERE related_plan_id=:plan AND workflow_type='plan_generate' AND status='succeeded'
      ORDER BY COALESCE(finished_at,created_at) DESC LIMIT 1"""), {"plan": plan_id}).mappings().first()
    if not run or not run["response_summary"]:
        return None
    try:
        outputs = json_value(run["response_summary"])
        if isinstance(outputs, str):
            outputs = json.loads(outputs)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(outputs, dict):
        return None
    for key in ("plan_explanation", "planExplanation", "coach_explanation", "coachExplanation"):
        value = outputs.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def plan_payload(db, plan):
    if not plan:
        return None
    workouts = db.execute(text("""SELECT w.*, c.source_key, c.content AS course_content,
      r.actual_distance_km AS actual_distance_km
      FROM workout w
      LEFT JOIN course_catalog c ON c.id=w.course_id
      LEFT JOIN training_record r ON r.workout_id=w.id
      WHERE w.plan_id=:pid ORDER BY w.week_no,w.day_no"""), {"pid": plan["id"]}).mappings().all()
    return {
        "id": plan["id"], "version": plan["version"], "status": plan["status"], "title": plan["title"],
        "goal": plan["goal"], "targetMinutes": float(plan["target_minutes"]) if plan["target_minutes"] is not None else None,
        "weeks": plan["weeks"], "trainDays": plan["train_days"], "summary": plan["summary"],
        "planExplanation": plan_explanation_for_plan(db, plan["id"]),
        "createdAt": plan["created_at"].isoformat(), "workouts": [{
            "id": w["id"], "week": w["week_no"], "day": w["day_no"], "type": w["type"], "title": w["title"],
            "durationMin": w["duration_min"], "distanceKm": float(w["distance_km"]) if w["distance_km"] is not None else None,
            "distanceRangeKm": workout_range_payload(w)[0], "paceRangeMinPerKm": workout_range_payload(w)[1],
            "actualDistanceKm": float(w["actual_distance_km"]) if w["actual_distance_km"] is not None else None,
            "intensity": w["intensity"], "talkTest": w["talk_test"], "purpose": w["purpose"],
            "prerequisite": w["prerequisite"], "downgradeRule": w["downgrade_rule"], "status": w["status"],
            "courseId": w["course_id"], "courseKey": w["source_key"], "courseName": w["title"],
            "courseContent": json_value(w["course_content"]) if w["course_content"] else None,
        } for w in workouts]
    }


@app.on_event("startup")
def startup():
    # The checked-in snapshot is transcribed from the currently associated Dify
    # dataset in its UI. Never seed the directory from a repository knowledge file.
    catalog_path = Path(__file__).with_name("course_catalog_dify.json")
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    if not isinstance(catalog, list) or not catalog:
        raise RuntimeError("Dify course catalog snapshot is empty or invalid")
    keys = [item.get("courseKey") for item in catalog]
    if len(keys) != len(set(keys)):
        raise RuntimeError("Dify course catalog snapshot contains duplicate courseKey values")
    with Session.begin() as db:
        db.execute(text("UPDATE course_catalog SET is_active=FALSE WHERE is_active=TRUE"))
        for item in catalog:
            key, name, source_type, level = (item.get("courseKey"), item.get("title"),
                                              item.get("type"), item.get("level"))
            mapped_type = normalize_catalog_course_type(source_type)
            ranges, pace = item.get("distanceRangeKm"), item.get("paceRangeMinPerKm")
            if (not key or not name or not mapped_type or not level
                    or not isinstance(ranges, list) or len(ranges) != 2
                    or not isinstance(pace, str) or not pace.strip()):
                raise RuntimeError(f"Invalid Dify course catalog entry: {key or '(missing courseKey)'}")
            course_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"zhicheng-course:{key}"))
            body = f"距离范围：{ranges[0]}–{ranges[1]} km\n配速范围：{pace}"
            snapshot = {"title": name, "courseKey": key,
                        "metadata": {"courseKey": key, "title": name, "type": source_type,
                                     "level": level, "goal": "10km"},
                        "distanceRangeKm": ranges, "paceRangeMinPerKm": pace, "body": body}
            db.execute(text("""INSERT INTO course_catalog(id,source_key,name,type,level,content,is_active,synced_at)
              VALUES(:id,:key,:name,:type,:level,:content,TRUE,UTC_TIMESTAMP(3))
              ON DUPLICATE KEY UPDATE name=VALUES(name),type=VALUES(type),level=VALUES(level),content=VALUES(content),is_active=TRUE,synced_at=VALUES(synced_at)"""), {
                "id": course_id, "key": key, "name": name, "type": source_type, "level": level,
                "content": json.dumps(snapshot, ensure_ascii=False),
            })


def dify_workflow(api_key: str, workflow_name: str, inputs: dict, user_id: str) -> dict:
    if not api_key:
        raise HTTPException(status_code=503, detail=f"尚未配置 Dify {workflow_name} 工作流 API Key")
    request = urllib.request.Request(
        f"{DIFY_API_BASE_URL}/workflows/run",
        data=json.dumps({"inputs": inputs, "response_mode": "streaming", "user": user_id}, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            event_name, outputs = "", None
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if line.startswith("event:"):
                    event_name = line[6:].strip()
                elif line.startswith("data:"):
                    raw_data = line[5:].strip()
                    try:
                        event_data = json.loads(raw_data)
                    except json.JSONDecodeError:
                        continue
                    # Dify streams may send the event name as an SSE `event:` field
                    # or only inside the JSON payload's `event` property.
                    current_event = event_data.get("event") or event_name
                    if current_event in {"node_started", "node_finished"}:
                        callback = WORKFLOW_PROGRESS.get()
                        node = event_data.get("data") or event_data
                        if callback:
                            callback({"event": current_event, "title": node.get("title", ""), "nodeType": node.get("node_type", "")})
                    elif current_event == "workflow_started":
                        callback = WORKFLOW_PROGRESS.get()
                        if callback:
                            callback({"event": current_event, "title": "", "nodeType": ""})
                    elif current_event == "workflow_finished":
                        run_data = event_data.get("data") or event_data
                        if run_data.get("status") not in (None, "succeeded"):
                            raise HTTPException(status_code=502, detail=f"Dify {workflow_name} 工作流执行失败")
                        outputs = run_data.get("outputs") or run_data.get("outputs_dict")
                        if not isinstance(outputs, dict):
                            outputs = event_data.get("outputs") or event_data.get("outputs_dict")
                        if isinstance(outputs, str):
                            try:
                                outputs = json.loads(outputs)
                            except json.JSONDecodeError:
                                outputs = None
                    elif current_event in {"error", "workflow_failed"}:
                        error_data = event_data.get("data") or event_data
                        raise HTTPException(status_code=502, detail=str(error_data.get("message") or f"Dify {workflow_name} 工作流执行失败"))
                elif not line:
                    event_name = ""
            if not isinstance(outputs, dict):
                raise HTTPException(status_code=502, detail=f"Dify {workflow_name} 工作流未返回有效输出")
            return outputs
    except (http.client.HTTPException, ConnectionError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Dify {workflow_name} 工作流流式响应中断，未收到完整结果") from exc
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail=f"Dify {workflow_name} 工作流调用失败") from exc


def workflow_stream(run_call):
    events = queue.Queue()
    sentinel = object()
    def emit(event): events.put(event)
    def run():
        marker = WORKFLOW_PROGRESS.set(emit)
        try: events.put({"event": "result", "data": run_call()})
        except Exception as exc: events.put({"event": "error", "message": getattr(exc, "detail", str(exc))})
        finally:
            WORKFLOW_PROGRESS.reset(marker)
            events.put(sentinel)
    threading.Thread(target=run, daemon=True).start()
    def body():
        while True:
            event = events.get()
            if event is sentinel: break
            yield f"event: {event.get('event', 'progress')}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
    return StreamingResponse(body(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def parse_json_output(value: Any, label: str) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail=f"Dify {label} 输出不是合法 JSON") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=502, detail=f"Dify {label} 输出结构不正确")
    return value


def plan_from_dify(db, user_id: str, profile: dict):
    if profile.get("averageDailyKm") is None:
        raise HTTPException(status_code=409, detail="请先补充平均日跑量（1–10 公里整数）后再生成计划")
    body_data = dict(profile.get("bodyData") or {})
    body_data.pop("level", None)
    body_data.update({"height_cm": profile["height"], "weight_kg": profile["weight"]})
    outputs = dify_workflow(DIFY_PLAN_API_KEY, "首次计划生成", {
        "goal": "完成10公里", "longest_run_km": str(profile["longestRunKm"]),
        "latest_10k_minutes": str(profile.get("latest10kMinutes") or ""), "train_days": str(profile["trainDays"]),
        "target_minutes": str(profile.get("targetMinutes") or ""), "health_status": profile.get("healthStatus") or "未提供",
        "average_daily_km": int(profile["averageDailyKm"]), "body_data": json.dumps(body_data, ensure_ascii=False),
    }, user_id)
    # The editor canvas labels this output "text"; the currently published API version returns "training_plan".
    result = parse_json_output(outputs.get("text", outputs.get("training_plan")), "首次计划")
    workouts = result.get("workouts")
    weeks, days = result.get("weeks"), result.get("trainDays")
    try:
        weeks, days = int(weeks), int(days)
    except (TypeError, ValueError):
        raise HTTPException(status_code=502, detail="Dify 首次计划周期或训练天数格式错误")
    if not isinstance(workouts, list) or not 8 <= weeks <= 12 or days != int(profile["trainDays"]):
        raise HTTPException(status_code=502, detail="Dify 首次计划未满足周期或训练天数约束")
    normalized = []
    ranges_by_position = {}
    distances_by_position = {}
    titles_by_position = {}
    course_ids_by_position = {}
    raw_types_by_position = {}
    course_keys_by_position = {}
    type_map = {"easy":"easy", "aerobic_base":"easy", "easy,aerobic_base":"easy", "run_walk":"easy", "recovery":"recovery", "long":"long", "long_run":"long", "quality":"quality", "strides":"quality", "tempo":"tempo", "interval":"interval", "rest":"rest", "other":"other"}
    for item in workouts:
        if not isinstance(item, dict): raise HTTPException(status_code=502, detail="Dify 计划包含无效训练条目")
        try:
            week, day = int(item.get("week", 0)), parse_workout_day(item.get("day", 0))
        except (TypeError, ValueError):
            raise HTTPException(status_code=502, detail="Dify 计划训练日期格式错误")
        workout_type = type_map.get(str(item.get("type") or "").lower())
        duration, distance = item.get("durationMin"), item.get("distanceKm")
        course_key, course_name = str(item.get("courseKey") or "").strip(), str(item.get("title") or "").strip()
        course_name = re.sub(rf"^{re.escape(course_key)}\s*(?:[-:：|｜]\s*)?", "", course_name).strip() if course_key else course_name
        course_key = canonical_course_key(course_key, course_name)
        catalog = db.execute(text("SELECT id,name,type,level,content FROM course_catalog WHERE source_key=:key AND is_active=TRUE"), {"key": course_key}).mappings().first()
        if not (course_key and course_name and 1 <= week <= weeks and 1 <= day <= 7 and (duration or distance)
                and item.get("intensity") and workout_type):
            raise HTTPException(status_code=502, detail=f"Dify 计划课程 {course_key or '（缺少编号）'} 缺少有效课程名、日期、训练目标、强度或课程类型")
        if not catalog or normalize_catalog_course_type(catalog["type"]) != workout_type:
            raise HTTPException(status_code=502, detail=f"Dify 课程 {course_key} 不在当前知识库目录中，或返回类型与目录不一致")
        # Persist the exact directory title whenever the selected courseKey maps
        # to that entry. This repairs model spacing/wording drift by course name.
        course_name = catalog["name"]
        # Require explicit ranges from the Dify result, then apply the exact
        # range and pace snapshot read from the currently associated dataset.
        distance_min, distance_max, pace_range = workout_range_values(item, catalog["content"], required=True)
        if workout_type != "rest":
            distance = target_distance_value(distance, distance_min, distance_max)
        course_ids_by_position[(week, day)] = catalog["id"]
        ranges_by_position[(week, day)] = (distance_min, distance_max, pace_range)
        distances_by_position[(week, day)] = distance
        titles_by_position[(week, day)] = course_name
        raw_types_by_position[(week, day)] = str(item.get("type") or "").lower()
        course_keys_by_position[(week, day)] = course_key
        normalized.append((week, day, workout_type))
    if len({(week, day) for week, day, _ in normalized}) != len(normalized):
        raise HTTPException(status_code=502, detail="Dify 计划重复安排了同一训练日期")
    primary_quality_types = {"quality", "tempo", "interval"}
    for week in range(1, weeks + 1):
        rows = sorted((day, kind) for w, day, kind in normalized if w == week)
        if len(rows) > days or not any(kind in {"easy", "recovery"} for _, kind in rows):
            raise HTTPException(status_code=502, detail="Dify 计划不符合每周训练次数或轻松/恢复课约束")
        if sum(raw_types_by_position[(week, day)] in primary_quality_types and course_keys_by_position[(week, day)] != "ST-4" for day, _ in rows) > 2:
            raise HTTPException(status_code=502, detail="Dify 计划每周质量课超过 2 次")

    day_moves = schedule_with_long_quality_spacing(normalized, raw_types_by_position, course_keys_by_position, weeks)
    if day_moves is None:
        raise HTTPException(status_code=502, detail="Dify 计划无法在每周 7 天内安排长距离课与质量课之间的间隔")
    if any(old_day != new_day for (week, old_day), new_day in day_moves.items()):
        def move_positions(values):
            return {(week, day_moves[(week, day)]): value for (week, day), value in values.items()}

        normalized = [(week, day_moves[(week, day)], kind) for week, day, kind in normalized]
        ranges_by_position = move_positions(ranges_by_position)
        distances_by_position = move_positions(distances_by_position)
        titles_by_position = move_positions(titles_by_position)
        course_ids_by_position = move_positions(course_ids_by_position)
        raw_types_by_position = move_positions(raw_types_by_position)
        course_keys_by_position = move_positions(course_keys_by_position)
        for item in workouts:
            week, old_day = int(item["week"]), parse_workout_day(item["day"])
            item["day"] = day_moves[(week, old_day)]

    quality_slots = {(w, day) for w, day, _ in normalized
                     if raw_types_by_position[(w, day)] in primary_quality_types and course_keys_by_position[(w, day)] != "ST-4"}
    for week in range(1, weeks + 1):
        rows = sorted((day, kind) for w, day, kind in normalized if w == week)
        for day, kind in rows:
            if kind == "long":
                adjacent = {(week, day - 1), (week, day + 1)}
                if day == 1: adjacent.add((week - 1, 7))
                if day == 7: adjacent.add((week + 1, 1))
                if adjacent & quality_slots:
                    raise HTTPException(status_code=502, detail="Dify 长距离课与质量课相邻")
    # train_days on a saved plan is the schedule's actual peak weekly
    # frequency; the profile value remains the user's maximum availability.
    scheduled_days = max(sum(1 for w, _, _ in normalized if w == week) for week in range(1, weeks + 1))
    existing = get_active_plan(db, user_id)
    version = int(existing["version"]) + 1 if existing else 1
    if existing:
        db.execute(text("UPDATE training_plan SET status='superseded',superseded_at=UTC_TIMESTAMP(3) WHERE id=:id"), {"id": existing["id"]})
    plan_id = uid()
    db.execute(text("""INSERT INTO training_plan(id,user_id,version,status,title,goal,target_minutes,weeks,train_days,source,summary,profile_snapshot)
      VALUES(:id,:uid,:version,'active',:title,'complete_10k',:target,:weeks,:days,'dify',:summary,:snapshot)"""), {
        "id": plan_id, "uid": user_id, "version": version, "title": str(result.get("title") or "10km训练计划")[:160],
        # The profile is authoritative when the model emits null for a supplied target.
        "target": result.get("targetMinutes") if result.get("targetMinutes") is not None else profile.get("targetMinutes"), "weeks": weeks, "days": scheduled_days,
        "summary": str(result.get("summary") or "由 Dify 首次计划工作流生成。"),
        "snapshot": json.dumps(profile, ensure_ascii=False),
    })
    for item in workouts:
        week, day = int(item["week"]), parse_workout_day(item["day"])
        duration = item.get("durationMin")
        distance = distances_by_position[(week, day)]
        workout_type = type_map[str(item["type"]).lower()]
        distance_min, distance_max, pace_range = ranges_by_position[(week, day)]
        db.execute(text("""INSERT INTO workout(id,plan_id,course_id,week_no,day_no,type,title,duration_min,distance_km,distance_min_km,distance_max_km,pace_range_min_per_km,intensity,talk_test,purpose,prerequisite,downgrade_rule,status)
          VALUES(:id,:plan,:course,:week,:day,:type,:title,:duration,:distance,:distance_min,:distance_max,:pace,:intensity,:talk,:purpose,:prerequisite,:down,'scheduled')"""), {
            "id": uid(), "plan": plan_id, "course": course_ids_by_position[(week, day)], "week": week, "day": day, "type": workout_type,
            "title": titles_by_position[(week, day)], "duration": duration, "distance": distance, "distance_min": distance_min,
            "distance_max": distance_max, "pace": pace_range,
            "intensity": str(item["intensity"])[:120], "talk": str(item.get("talkTest") or ""),
            "purpose": str(item.get("purpose") or ""), "prerequisite": str(item.get("prerequisite") or ""),
            "down": str(item.get("downgradeRule") or ""),
        })
    return db.execute(text("SELECT * FROM training_plan WHERE id=:id"), {"id": plan_id}).mappings().first(), outputs


@app.get("/api/health")
def health():
    try:
        with engine.connect() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="数据库暂不可用")


@app.post("/api/auth/register")
def register(payload: Credentials):
    user_id = uid()
    try:
        with Session.begin() as db:
            db.execute(text("INSERT INTO app_user(id,account,password_hash) VALUES(:id,:account,:hash)"), {
                "id": user_id, "account": payload.account, "hash": hash_password(payload.password)
            })
    except IntegrityError:
        raise HTTPException(status_code=409, detail="该账号已注册")
    return {"accessToken": token_for(user_id, payload.account), "tokenType": "bearer", "account": payload.account}


@app.post("/api/auth/login")
def login(payload: Credentials):
    with Session.begin() as db:
        row = db.execute(text("SELECT id,account,password_hash,status FROM app_user WHERE account=:account"), {"account": payload.account}).mappings().first()
        if not row or row["status"] != "active" or not verify_password(payload.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="账号或密码错误")
        db.execute(text("UPDATE app_user SET last_login_at=UTC_TIMESTAMP(3) WHERE id=:id"), {"id": row["id"]})
    return {"accessToken": token_for(row["id"], row["account"]), "tokenType": "bearer", "account": row["account"]}


@app.get("/api/profile")
def read_profile(user=Depends(current_user)):
    with Session() as db:
        return {"profile": get_profile(db, user["id"])}


@app.put("/api/profile")
def save_profile(payload: RunnerProfile, user=Depends(current_user)):
    if payload.goal != "完成 10 公里":
        raise HTTPException(status_code=422, detail="当前版本仅支持完成 10 公里目标")
    profile_values = payload.model_dump()
    body = dict(payload.bodyData)
    body.pop("level", None)
    body["health"] = payload.health
    health_status = payload.healthStatus or "、".join(payload.health)
    with Session.begin() as db:
        db.execute(text("""INSERT INTO runner_profile(user_id,height_cm,weight_kg,goal,longest_run_km,average_daily_km,latest_10k_minutes,train_days,target_minutes,health_status,body_data)
          VALUES(:uid,:height,:weight,'complete_10k',:longest,:average_daily,:latest,:days,:target,:health,:body)
          ON DUPLICATE KEY UPDATE height_cm=VALUES(height_cm),weight_kg=VALUES(weight_kg),goal=VALUES(goal),longest_run_km=VALUES(longest_run_km),average_daily_km=VALUES(average_daily_km),latest_10k_minutes=VALUES(latest_10k_minutes),train_days=VALUES(train_days),target_minutes=VALUES(target_minutes),health_status=VALUES(health_status),body_data=VALUES(body_data)"""), {
            "uid": user["id"], "height": payload.height, "weight": payload.weight, "longest": payload.longestRunKm,
            "average_daily": payload.averageDailyKm, "latest": payload.latest10kMinutes, "days": payload.trainDays, "target": payload.targetMinutes,
            "health": health_status, "body": json.dumps(body, ensure_ascii=False),
        })
    profile_values["bodyData"] = body
    return {"profile": profile_values}


@app.post("/api/plans/generate")
def generate_plan(user=Depends(current_user), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    with Session.begin() as db:
        profile = get_profile(db, user["id"])
        if not profile:
            raise HTTPException(status_code=409, detail="请先完成跑者档案")
        if idempotency_key:
            cached = db.execute(text("SELECT related_plan_id FROM ai_workflow_run WHERE user_id=:uid AND workflow_type='plan_generate' AND idempotency_key=:key AND status='succeeded'"), {"uid": user["id"], "key": idempotency_key}).first()
            if cached and cached[0]:
                plan = db.execute(text("SELECT * FROM training_plan WHERE id=:id"), {"id": cached[0]}).mappings().first()
                return {"plan": plan_payload(db, plan)}
        plan, dify_outputs = plan_from_dify(db, user["id"], profile)
        if idempotency_key:
            db.execute(text("""INSERT INTO ai_workflow_run(id,user_id,workflow_type,idempotency_key,status,request_summary,response_summary,validation_result,related_plan_id,finished_at)
              VALUES(:id,:uid,'plan_generate',:key,'succeeded',:request,:response,:validation,:plan,UTC_TIMESTAMP(3))"""), {
                "id": uid(), "uid": user["id"], "key": idempotency_key,
                "request": json.dumps(profile, ensure_ascii=False), "response": json.dumps(dify_outputs, ensure_ascii=False),
                "validation": json.dumps({"passed": True, "source": "dify_workflow"}), "plan": plan["id"],
            })
        return {"plan": plan_payload(db, plan)}


@app.post("/api/plans/generate/stream")
def generate_plan_stream(user=Depends(current_user), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    return workflow_stream(lambda: generate_plan(user, idempotency_key))


@app.get("/api/plans/active")
def active_plan(user=Depends(current_user)):
    with Session() as db:
        return {"plan": plan_payload(db, get_active_plan(db, user["id"]))}


@app.get("/api/plans/adjustments/latest")
def latest_plan_adjustment(user=Depends(current_user)):
    with Session() as db:
        run = db.execute(text("""SELECT related_plan_id,related_feedback_id
          FROM ai_workflow_run
          WHERE user_id=:uid AND workflow_type='plan_adjust' AND status='succeeded' AND related_plan_id IS NOT NULL
          ORDER BY COALESCE(finished_at,created_at) DESC LIMIT 1"""), {"uid": user["id"]}).mappings().first()
        if not run:
            return {"plan": plan_payload(db, get_active_plan(db, user["id"])), "previousPlan": None,
                    "adjustment": None, "feedbackAnalysis": ""}
        adjusted_plan = db.execute(text("SELECT * FROM training_plan WHERE id=:id AND user_id=:uid"), {
            "id": run["related_plan_id"], "uid": user["id"],
        }).mappings().first()
        if not adjusted_plan:
            return {"plan": None, "previousPlan": None, "adjustment": None, "feedbackAnalysis": ""}
        previous_plan = db.execute(text("SELECT * FROM training_plan WHERE user_id=:uid AND version=:version"), {
            "uid": user["id"], "version": max(0, int(adjusted_plan["version"]) - 1),
        }).mappings().first()
        feedback = db.execute(text("SELECT analysis_result FROM training_feedback WHERE id=:id AND user_id=:uid"), {
            "id": run["related_feedback_id"], "uid": user["id"],
        }).first() if run["related_feedback_id"] else None
        adjustment = json_value(feedback[0]) if feedback and feedback[0] else None
        if adjustment is not None and not adjustment.get("planChanges"):
            previous_plan = adjusted_plan
        return {
            "plan": plan_payload(db, adjusted_plan),
            "previousPlan": plan_payload(db, previous_plan),
            "adjustment": adjustment,
            "feedbackAnalysis": str((adjustment or {}).get("feedback_analysis") or ""),
        }


@app.get("/api/workouts/today")
def today_workout(user=Depends(current_user)):
    with Session() as db:
        plan = get_active_plan(db, user["id"])
        if not plan:
            return {"workout": None}
        row = db.execute(text("""SELECT w.*,c.source_key,c.content AS course_content FROM workout w LEFT JOIN course_catalog c ON c.id=w.course_id
          WHERE w.plan_id=:pid AND w.status IN ('scheduled','in_progress')
          ORDER BY w.week_no,w.day_no LIMIT 1"""), {"pid": plan["id"]}).mappings().first()
        if not row:
            return {"workout": None}
        distance_range, pace_range = workout_range_payload(row)
        return {"workout": {"id": row["id"], "week": row["week_no"], "day": row["day_no"], "type": row["type"], "title": row["title"], "courseName": row["title"], "courseId": row["course_id"], "courseKey": row["source_key"], "durationMin": row["duration_min"], "distanceKm": float(row["distance_km"]) if row["distance_km"] else None, "distanceRangeKm": distance_range, "paceRangeMinPerKm": pace_range, "intensity": row["intensity"], "talkTest": row["talk_test"], "status": row["status"]}}


@app.post("/api/workouts/{workout_id}/start")
def start_workout(workout_id: str, user=Depends(current_user)):
    record_id = uid()
    with Session.begin() as db:
        row = db.execute(text("""SELECT w.id,w.status FROM workout w JOIN training_plan p ON p.id=w.plan_id
          WHERE w.id=:wid AND p.user_id=:uid AND p.status='active' FOR UPDATE"""), {"wid": workout_id, "uid": user["id"]}).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="未找到当前训练")
        record = db.execute(text("SELECT id FROM training_record WHERE workout_id=:wid"), {"wid": workout_id}).first()
        if record:
            record_id = record[0]
        else:
            db.execute(text("UPDATE workout SET status='in_progress',started_at=UTC_TIMESTAMP(3) WHERE id=:wid"), {"wid": workout_id})
            db.execute(text("INSERT INTO training_record(id,workout_id,user_id,status,started_at) VALUES(:id,:wid,:uid,'partial',UTC_TIMESTAMP(3))"), {"id": record_id, "wid": workout_id, "uid": user["id"]})
    return {"trainingRecordId": record_id}


@app.post("/api/training-records/{record_id}/finish")
def finish_record(record_id: str, payload: RunFinish, user=Depends(current_user)):
    record_status = "completed" if payload.completed else "partial"
    with Session.begin() as db:
        row = db.execute(text("SELECT id,workout_id,started_at FROM training_record WHERE id=:id AND user_id=:uid FOR UPDATE"), {"id": record_id, "uid": user["id"]}).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="训练记录不存在")
        minutes = payload.durationMin
        pace = int(minutes * 60 / payload.distanceKm) if payload.distanceKm > 0 else None
        db.execute(text("UPDATE training_record SET status=:status,actual_distance_km=:distance,actual_duration_min=:duration,pace_seconds_per_km=:pace,completed_at=UTC_TIMESTAMP(3) WHERE id=:id"), {"status": record_status, "distance": payload.distanceKm, "duration": minutes, "pace": pace, "id": record_id})
        db.execute(text("UPDATE workout SET status=:status WHERE id=:wid"), {"status": record_status, "wid": row["workout_id"]})
    return {"trainingRecordId": record_id, "status": record_status}


def adjustment_items_from_result(ai_result: dict) -> list[dict]:
    """Validate the single Dify adjustment list and return all persisted changes."""
    plan_changes = ai_result.get("planChanges")
    if not isinstance(plan_changes, list):
        raise HTTPException(status_code=502, detail="Dify 训练调整输出字段不完整")
    if any(not isinstance(item, dict) or not item for item in plan_changes):
        raise HTTPException(status_code=502, detail="Dify 调整课程清单包含无效条目")

    def identity(item):
        try:
            return int(item["week"]), parse_workout_day(item["day"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=502, detail="Dify 调整训练缺少有效 week/day")

    plan_by_day = {}
    for item in plan_changes:
        key = identity(item)
        if key in plan_by_day:
            raise HTTPException(status_code=502, detail="Dify planChanges 包含重复训练日期")
        if str(item.get("type") or "").lower() == "rest" and not is_rest_cancellation(item):
            raise HTTPException(status_code=502, detail="休息课程必须使用取消格式：durationMin=0、distanceKm=0")
        plan_by_day[key] = item

    status = ai_result.get("status")
    scope = ai_result.get("adjustmentScope")
    if not plan_changes and scope != "none":
        raise HTTPException(status_code=502, detail="无课程变更时 adjustmentScope 必须为 none")
    if plan_changes and scope == "none":
        raise HTTPException(status_code=502, detail="存在课程变更时 adjustmentScope 不能为 none")
    if status == "maintain" and plan_changes:
        raise HTTPException(status_code=502, detail="status=maintain 时不得返回课程变更")
    return plan_changes


def is_rest_cancellation(item: dict) -> bool:
    """A cancellation is identified by its own course entry, not global status."""
    return (
        str(item.get("type") or "").lower() == "rest"
        and item.get("durationMin") in (0, 0.0, "0")
        and item.get("distanceKm") in (None, 0, 0.0, "0")
    )


def clone_plan_with_dify_adjustment(db, user_id: str, old_plan, ai_result: dict):
    """Persist Dify's returned course changes while carrying forward untouched history."""
    new_id = uid()
    version = int(old_plan["version"]) + 1
    db.execute(text("UPDATE training_plan SET status='superseded',superseded_at=UTC_TIMESTAMP(3) WHERE id=:id"), {"id": old_plan["id"]})
    db.execute(text("""INSERT INTO training_plan(id,user_id,version,status,title,goal,target_minutes,weeks,train_days,source,summary,profile_snapshot)
      VALUES(:id,:uid,:version,'active',:title,:goal,:target,:weeks,:days,:source,:summary,:snapshot)"""), {
        "id": new_id, "uid": user_id, "version": version, "title": old_plan["title"], "goal": old_plan["goal"],
        "target": old_plan["target_minutes"], "weeks": old_plan["weeks"], "days": old_plan["train_days"],
        "source": "dify", "summary": "由 Dify 训练反馈调整工作流生成。",
        "snapshot": old_plan["profile_snapshot"],
    })
    old_workouts = db.execute(text("SELECT * FROM workout WHERE plan_id=:id ORDER BY week_no,day_no"), {"id": old_plan["id"]}).mappings().all()
    for item in old_workouts:
        db.execute(text("""INSERT INTO workout(id,plan_id,course_id,week_no,day_no,type,title,duration_min,distance_km,distance_min_km,distance_max_km,pace_range_min_per_km,intensity,talk_test,purpose,prerequisite,downgrade_rule,status,started_at)
          VALUES(:id,:plan,:course,:week,:day,:type,:title,:duration,:distance,:distance_min,:distance_max,:pace,:intensity,:talk,:purpose,:prerequisite,:down,:status,:started)"""), {
            "id": uid(), "plan": new_id, "course": item["course_id"], "week": item["week_no"], "day": item["day_no"],
            "type": item["type"], "title": item["title"], "duration": item["duration_min"], "distance": item["distance_km"],
            "distance_min": item["distance_min_km"], "distance_max": item["distance_max_km"], "pace": item["pace_range_min_per_km"],
            "intensity": item["intensity"], "talk": item["talk_test"], "purpose": item["purpose"],
            "prerequisite": item["prerequisite"], "down": item["downgrade_rule"],
            "status": "scheduled" if item["status"] == "in_progress" else item["status"],
            "started": None if item["status"] == "in_progress" else item["started_at"],
        })
    adjustment_items = adjustment_items_from_result(ai_result)
    for item in adjustment_items:
        row = db.execute(text("""SELECT w.id,w.type,w.title,w.distance_km,w.pace_range_min_per_km,c.source_key
          FROM workout w LEFT JOIN course_catalog c ON c.id=w.course_id
          WHERE w.plan_id=:pid AND w.week_no=:week AND w.day_no=:day AND w.status='scheduled'"""), {
            "pid": new_id, "week": int(item["week"]), "day": int(item["day"]),
        }).mappings().first()
        if not row:
            raise HTTPException(status_code=502, detail="Dify 调整返回了不存在或已完成的训练日期")
        cancel_for_rest = is_rest_cancellation(item)
        if cancel_for_rest:
            if str(item.get("courseKey") or "").strip() != str(row["source_key"] or "").strip() or str(item.get("title") or "").strip() != str(row["title"] or "").strip():
                raise HTTPException(status_code=502, detail="取消课程必须保留目标课原有 courseKey 和 title")
            db.execute(text("""UPDATE workout SET duration_min=0,distance_km=NULL,distance_min_km=NULL,distance_max_km=NULL,
              pace_range_min_per_km=NULL,intensity='休息',purpose=:purpose,downgrade_rule=:down,status='skipped' WHERE id=:id"""), {
                "id": row["id"], "purpose": str(item.get("note") or "因本次反馈取消该课程")[:500],
                "down": str(item.get("downgradeRule") or "")[:500],
            })
            continue
        raw_type = str(item.get("type") or row["type"]).lower()
        typ = {"easy":"easy", "aerobic_base":"easy", "easy,aerobic_base":"easy", "run_walk":"easy", "recovery":"recovery", "long":"long", "long_run":"long", "quality":"quality", "strides":"quality", "tempo":"tempo", "interval":"interval", "rest":"rest", "other":"other"}.get(raw_type)
        if not typ:
            raise HTTPException(status_code=502, detail="Dify 调整返回了不支持的课程类型")
        if not cancel_for_rest and not (item.get("durationMin") or item.get("distanceKm")):
            raise HTTPException(status_code=502, detail="Dify 调整训练缺少时长或距离")
        course_key = str(item.get("courseKey") or "").strip()
        course_name = str(item.get("title") or "").strip()
        course_name = re.sub(rf"^{re.escape(course_key)}\s*(?:[-:：|｜]\s*)?", "", course_name).strip() if course_key else course_name
        course_key = canonical_course_key(course_key, course_name)
        catalog = db.execute(text("SELECT id,name,type,content FROM course_catalog WHERE source_key=:key AND is_active=TRUE"), {"key": course_key}).mappings().first()
        if not catalog or normalize_catalog_course_type(catalog["type"]) != typ:
            raise HTTPException(status_code=502, detail="Dify 调整课程必须匹配知识库中的 courseKey 和课程类型")
        course_name = catalog["name"]
        percentage_reduction = ai_result.get("status") in {"reduce", "recovery"} and row["distance_km"] is not None
        if percentage_reduction:
            # These ranges are derived from the existing workout, not constrained
            # by the catalog's generic ranges; the course identity still must match
            # an active catalog entry above.
            distance_min, distance_max, pace_range = workout_range_values(item, required=True)
            target_distance = item.get("distanceKm")
            if (isinstance(target_distance, bool) or not isinstance(target_distance, (int, float))
                    or not math.isfinite(target_distance) or target_distance < distance_min
                    or target_distance > distance_max):
                raise HTTPException(status_code=502, detail="按比例调整后的训练距离必须落在其减量区间内")
        else:
            distance_min, distance_max, pace_range = workout_range_values(item, catalog["content"], required=False)
            target_distance = target_distance_value(item.get("distanceKm"), distance_min, distance_max)
        if percentage_reduction:
            original_distance = float(row["distance_km"])
            if target_distance >= original_distance:
                raise HTTPException(status_code=502, detail="减量或恢复调整的课程距离必须低于原计划")
            original_paces = pace_intervals_seconds(row["pace_range_min_per_km"])
            adjusted_paces = pace_intervals_seconds(pace_range)
            if original_paces and adjusted_paces:
                old_start, old_end = original_paces[0]
                if not all(start > old_start and end > old_end for start, end in adjusted_paces):
                    raise HTTPException(status_code=502, detail="减量或恢复调整的配速范围必须整体慢于原计划（上下界每公里用时都增加）")
        db.execute(text("""UPDATE workout SET course_id=:course,type=:type,title=:title,duration_min=:duration,distance_km=:distance,
          distance_min_km=:distance_min,distance_max_km=:distance_max,pace_range_min_per_km=:pace,
          intensity=:intensity,talk_test=:talk,purpose=:purpose,downgrade_rule=:down,status=:status WHERE id=:id"""), {
            "id": row["id"], "course": catalog["id"], "title": catalog["name"], "type": typ, "duration": item.get("durationMin"), "distance": target_distance,
            "distance_min": distance_min, "distance_max": distance_max, "pace": pace_range,
            "intensity": "休息" if cancel_for_rest else str(item.get("intensity") or "")[:120], "talk": str(item.get("talkTest") or ""),
            "purpose": str(item.get("note") or item.get("purpose") or ""), "down": str(item.get("downgradeRule") or ""),
            "status": "scheduled",
        })
    return db.execute(text("SELECT * FROM training_plan WHERE id=:id"), {"id": new_id}).mappings().first()


@app.post("/api/training-records/{record_id}/feedback")
def save_feedback(record_id: str, payload: Feedback, user=Depends(current_user)):
    if payload.completion not in ("completed", "partial", "missed", "unknown"):
        raise HTTPException(status_code=422, detail="完成情况不合法")
    feedback_id = uid()
    discomfort = payload.pain >= 3
    discomfort_parts: list[str] = []
    with Session.begin() as db:
        record = db.execute(text("SELECT id FROM training_record WHERE id=:id AND user_id=:uid"), {"id": record_id, "uid": user["id"]}).first()
        if not record:
            raise HTTPException(status_code=404, detail="训练记录不存在")
        existing = db.execute(text("SELECT id,analysis_result FROM training_feedback WHERE training_record_id=:id"), {"id": record_id}).first()
        if existing:
            return {"feedbackId": existing[0], "analysis": json_value(existing[1]) if existing[1] else None}
        db.execute(text("""INSERT INTO training_feedback(id,training_record_id,user_id,completion,subjective,physical,pain,discomfort,discomfort_parts,note,analysis_result)
          VALUES(:id,:record,:uid,:completion,:subjective,:physical,:pain,:discomfort,:parts,:note,NULL)"""), {
            "id": feedback_id, "record": record_id, "uid": user["id"], "completion": payload.completion,
            "subjective": payload.subjective, "physical": payload.physical, "pain": payload.pain,
            "discomfort": discomfort, "parts": json.dumps(discomfort_parts, ensure_ascii=False),
            "note": payload.note,
        })
    return {"feedbackId": feedback_id, "analysis": None}


@app.post("/api/training-records/{record_id}/adjust-plan")
def adjust_plan(record_id: str, user=Depends(current_user)):
    with Session.begin() as db:
        row = db.execute(text("""SELECT f.*,r.workout_id,r.actual_distance_km,r.actual_duration_min,r.pace_seconds_per_km
          FROM training_feedback f JOIN training_record r ON r.id=f.training_record_id
          WHERE f.training_record_id=:rid AND f.user_id=:uid"""), {"rid": record_id, "uid": user["id"]}).mappings().first()
        if not row:
            raise HTTPException(status_code=409, detail="请先提交训练反馈")
        active = get_active_plan(db, user["id"])
        if not active:
            raise HTTPException(status_code=409, detail="当前没有可调整的计划")
        current_plan = plan_payload(db, active)
        # Keep the profile in the Dify-only context so adjusted targets can be
        # personalized while preserving the public plan API contract.
        current_plan["runnerProfile"] = get_profile(db, user["id"]) or {}
        # Give Dify the three most recent sessions through the session being
        # reviewed, including completed workouts as read-only context. Keep the
        # editable future targets separate so a completed workout can never be changed.
        all_workouts = current_plan["workouts"]
        anchor_index = next((i for i, item in enumerate(all_workouts) if item["id"] == row["workout_id"]), len(all_workouts) - 1)
        recent_workouts = all_workouts[max(0, anchor_index - 2):anchor_index + 1]
        upcoming = [item for item in all_workouts[anchor_index + 1:] if item["status"] in {"scheduled", "in_progress"}]
        current_plan["recentWorkouts"] = recent_workouts
        current_plan["workouts"] = upcoming[:3]
        current_week = upcoming[0]["week"] if upcoming else None
        current_plan["adjustmentTargets"] = {
            "next_1": upcoming[:1], "next_2": upcoming[:2], "next_3": upcoming[:3],
            "current_week": [item for item in upcoming if item["week"] == current_week],
        }
        feedback = {
            "completion": row["completion"], "subjective": row["subjective"], "physical": row["physical"],
            "pain": row["pain"], "note": row["note"],
            "completed": {
                "distanceKm": float(row["actual_distance_km"]) if row["actual_distance_km"] is not None else None,
                "durationMin": float(row["actual_duration_min"]) if row["actual_duration_min"] is not None else None,
                "pace": (f"{int(row['pace_seconds_per_km']) // 60}:{int(row['pace_seconds_per_km']) % 60:02d} min/km"
                         if row["pace_seconds_per_km"] is not None else None),
            },
        }
        outputs = dify_workflow(DIFY_ADJUST_API_KEY, "训练反馈调整", {
            "current_plan": json.dumps(current_plan, ensure_ascii=False),
            "training_feedback": json.dumps(feedback, ensure_ascii=False),
        }, user["id"])
        ai_result = parse_json_output(outputs.get("adjusted_plan"), "训练调整")
        valid_status = {"maintain","progress","reduce","recovery","rest","medical_review"}
        valid_scope = {"none","next_1","next_2","next_3","current_week"}
        if (ai_result.get("status") not in valid_status or ai_result.get("adjustmentScope") not in valid_scope
                or not isinstance(ai_result.get("planChanges"), list)):
            raise HTTPException(status_code=502, detail="Dify 训练调整输出字段不完整")
        requested_scope = ai_result["adjustmentScope"]
        if not ai_result["planChanges"]:
            ai_result["adjustmentScope"] = "none"
        scope = ai_result["adjustmentScope"]
        target_rows = current_plan["adjustmentTargets"].get(requested_scope, [])
        target_days = {(int(item["week"]), parse_workout_day(item["day"])) for item in target_rows}
        adjustment_items = adjustment_items_from_result(ai_result)
        # Severe pain is a hard safety rule, not an LLM preference: require
        # medical review and cancel every editable future course in scope.
        if int(row["pain"] or 0) >= 4:
            expected_days = {(int(item["week"]), parse_workout_day(item["day"])) for item in target_rows}
            actual_days = {(int(item["week"]), parse_workout_day(item["day"])) for item in adjustment_items}
            if (ai_result["status"] != "medical_review" or not expected_days
                    or actual_days != expected_days
                    or any(not is_rest_cancellation(item) for item in adjustment_items)):
                raise HTTPException(status_code=502, detail="疼痛评分≥4时必须进入 medical_review，并取消调整范围内全部未来课程")
        def is_in_scope(item):
            try:
                return isinstance(item, dict) and (int(item.get("week", 0)), parse_workout_day(item.get("day", 0))) in target_days
            except (TypeError, ValueError):
                return False
        if any(not is_in_scope(item) for item in adjustment_items):
            raise HTTPException(status_code=502, detail="Dify 调整课程超出了反馈分析指定的训练范围")
        # First keep a valid Dify reduction. If it is not actually lighter,
        # search the active Dify-synced catalog for a lower-load substitute
        # instead of failing the whole feedback submission.
        target_by_day = {(int(item["week"]), parse_workout_day(item["day"])): item for item in target_rows}
        original_count = len(adjustment_items)
        accepted_items = []
        substituted_items = False
        for item in adjustment_items:
            original = target_by_day.get((int(item["week"]), parse_workout_day(item["day"])))
            if is_rest_cancellation(item):
                accepted_items.append(item)
                continue
            if not original:
                continue
            if ai_result["status"] in {"reduce", "recovery"}:
                candidate_item = None
                try:
                    course_key = str(item.get("courseKey") or "").strip()
                    course_name = str(item.get("title") or "").strip()
                    course_name = re.sub(rf"^{re.escape(course_key)}\s*(?:[-:：|｜]\s*)?", "", course_name).strip() if course_key else course_name
                    course_key = canonical_course_key(course_key, course_name)
                    catalog = db.execute(text("SELECT type,content FROM course_catalog WHERE source_key=:key AND is_active=TRUE"),
                                         {"key": course_key}).mappings().first()
                    item_type = {"easy":"easy", "aerobic_base":"easy", "easy,aerobic_base":"easy", "run_walk":"easy",
                                 "recovery":"recovery", "long":"long", "long_run":"long", "quality":"quality",
                                 "strides":"quality", "tempo":"tempo", "interval":"interval", "other":"other"}.get(
                                     str(item.get("type") or "").lower())
                    if catalog and normalize_catalog_course_type(catalog["type"]) == item_type:
                        candidate_item = percentage_lower_load_prescription(original, item)
                        if candidate_item:
                            substituted_items = True
                except HTTPException:
                    candidate_item = None
                if candidate_item is None:
                    continue
                accepted_items.append(candidate_item)
            else:
                accepted_items.append(item)
        adjustment_items = accepted_items
        ai_result["planChanges"] = adjustment_items
        if not adjustment_items:
            ai_result["adjustmentScope"] = "none"
        filtered_invalid_items = len(adjustment_items) < original_count or substituted_items
        feedback_analysis = coach_adjustment_explanation(
            feedback, ai_result, current_plan, force_compose=bool(adjustment_items) or filtered_invalid_items
        )
        ai_result["feedback_analysis"] = feedback_analysis
        for item in adjustment_items:
            if not isinstance(item, dict):
                raise HTTPException(status_code=502, detail="Dify 训练调整包含无效训练条目")
            try:
                week, day = int(item["week"]), parse_workout_day(item["day"])
            except (KeyError, TypeError, ValueError):
                raise HTTPException(status_code=502, detail="Dify 调整训练缺少有效 week/day")
            cancel_for_rest = is_rest_cancellation(item)
            has_positive_target = bool(item.get("durationMin") or item.get("distanceKm"))
            if not (1 <= week <= int(active["weeks"]) and 1 <= day <= 7 and item.get("type") and item.get("intensity")
                    and (has_positive_target or cancel_for_rest)):
                raise HTTPException(status_code=502, detail="Dify 调整训练条目缺少课程类型、目标或强度")
        if not adjustment_items:
            db.execute(text("UPDATE training_feedback SET analysis_result=:analysis WHERE id=:id"), {
                "id": row["id"], "analysis": json.dumps(ai_result, ensure_ascii=False),
            })
            db.execute(text("""INSERT INTO ai_workflow_run(id,user_id,workflow_type,idempotency_key,status,request_summary,response_summary,validation_result,related_plan_id,related_feedback_id,finished_at)
              VALUES(:id,:uid,'plan_adjust',:key,'succeeded',:request,:response,:validation,:plan,:feedback,UTC_TIMESTAMP(3))"""), {
                "id": uid(), "uid": user["id"], "key": uid(), "request": json.dumps(feedback, ensure_ascii=False),
                "response": json.dumps(outputs, ensure_ascii=False),
                "validation": json.dumps({"passed": True, "source": "dify_workflow", "savedCourseChanges": 0,
                                           "filteredInvalidChanges": original_count}, ensure_ascii=False),
                "plan": active["id"], "feedback": row["id"],
            })
            return {"plan": plan_payload(db, active), "adjustment": ai_result, "feedbackAnalysis": feedback_analysis,
                    "warmupStretchSources": outputs.get("warmup_stretch_sources", [])}
        plan = clone_plan_with_dify_adjustment(db, user["id"], active, ai_result)
        adjustment = ai_result
        db.execute(text("UPDATE training_feedback SET analysis_result=:analysis WHERE id=:id"), {
            "id": row["id"], "analysis": json.dumps(adjustment, ensure_ascii=False),
        })
        feedback_id = row["id"]
        db.execute(text("""INSERT INTO ai_workflow_run(id,user_id,workflow_type,idempotency_key,status,request_summary,response_summary,validation_result,related_plan_id,related_feedback_id,finished_at)
          VALUES(:id,:uid,'plan_adjust',:key,'succeeded',:request,:response,:validation,:plan,:feedback,UTC_TIMESTAMP(3))"""), {
            # Each adjustment invocation must run Dify again, even for the same feedback.
            # Use a fresh key because the table has a unique index over user/workflow/key.
            "id": uid(), "uid": user["id"], "key": uid(), "request": json.dumps(feedback, ensure_ascii=False),
            "response": json.dumps(outputs, ensure_ascii=False), "validation": json.dumps({"passed": True, "source": "dify_workflow"}),
            "plan": plan["id"], "feedback": feedback_id,
        })
        return {"plan": plan_payload(db, plan), "adjustment": adjustment, "feedbackAnalysis": feedback_analysis, "warmupStretchSources": outputs.get("warmup_stretch_sources", [])}


@app.post("/api/training-records/{record_id}/adjust-plan/stream")
def adjust_plan_stream(record_id: str, user=Depends(current_user)):
    return workflow_stream(lambda: adjust_plan(record_id, user))


@app.get("/api/me")
def me(user=Depends(current_user)):
    return {"account": user["account"]}


@app.delete("/api/me/account")
def delete_account(user=Depends(current_user)):
    with Session.begin() as db:
        exists = db.execute(text("SELECT id FROM app_user WHERE id=:uid FOR UPDATE"), {"uid": user["id"]}).first()
        if not exists:
            raise HTTPException(status_code=404, detail="账号不存在或已注销")
        # Remove only this account's records in dependency order; the shared course catalog remains intact.
        db.execute(text("DELETE FROM training_feedback WHERE user_id=:uid"), {"uid": user["id"]})
        db.execute(text("DELETE FROM training_record WHERE user_id=:uid"), {"uid": user["id"]})
        db.execute(text("DELETE FROM ai_workflow_run WHERE user_id=:uid"), {"uid": user["id"]})
        db.execute(text("DELETE FROM workout WHERE plan_id IN (SELECT id FROM training_plan WHERE user_id=:uid)"), {"uid": user["id"]})
        db.execute(text("DELETE FROM training_plan WHERE user_id=:uid"), {"uid": user["id"]})
        db.execute(text("DELETE FROM runner_profile WHERE user_id=:uid"), {"uid": user["id"]})
        db.execute(text("DELETE FROM app_user WHERE id=:uid"), {"uid": user["id"]})
    return {"deleted": True}


frontend_dir = Path(os.environ.get("FRONTEND_DIR", "../frontend")).resolve()
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
