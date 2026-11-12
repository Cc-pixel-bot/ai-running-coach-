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
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
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
KNOWLEDGE_BASE_DIR = Path(os.environ.get("KNOWLEDGE_BASE_DIR", "../docs/knowledge-base")).resolve()
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=1800)
Session = sessionmaker(bind=engine, expire_on_commit=False)
bearer = HTTPBearer(auto_error=False)
app = FastAPI(title="智程 AI 跑步教练 API", version="1.0.0")


def uid() -> str:
    return str(uuid.uuid4())


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
        if not isinstance(raw_pace, str) or not raw_pace.strip() or not re.search(r"\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}\s*min/km", raw_pace, re.I):
            raise HTTPException(status_code=502, detail="课程 paceRangeMinPerKm 必须包含具体分钟/公里区间")
        raw_pace = raw_pace.strip()
    else:
        raw_min = raw_max = None
    if required and (raw_min is None or raw_max is None or not raw_pace):
        raise HTTPException(status_code=502, detail="Dify 计划课程必须包含具体距离和配速范围")
    return raw_min, raw_max, raw_pace


def workout_range_payload(row: Any) -> tuple[list[float] | None, str | None]:
    distance_min, distance_max = row["distance_min_km"], row["distance_max_km"]
    pace = row["pace_range_min_per_km"]
    if distance_min is not None and distance_max is not None and pace:
        return [float(distance_min), float(distance_max)], pace
    fallback_min, fallback_max, fallback_pace = parse_course_ranges(row["course_content"] if "course_content" in row else None)
    if distance_min is None or distance_max is None:
        distance_min, distance_max = fallback_min, fallback_max
    if not pace:
        pace = fallback_pace
    distance_range = [float(distance_min), float(distance_max)] if distance_min is not None and distance_max is not None else None
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
    pain: int = Field(ge=1, le=5)
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
    health = json_value(row["body_data"]).get("health", [])
    return {
        "height": float(row["height_cm"]), "weight": float(row["weight_kg"]), "goal": "完成 10 公里",
        "longestRunKm": float(row["longest_run_km"]), "latest10kMinutes": float(row["latest_10k_minutes"]) if row["latest_10k_minutes"] is not None else None,
        "trainDays": int(row["train_days"]), "targetMinutes": float(row["target_minutes"]) if row["target_minutes"] is not None else None,
        "health": health, "healthStatus": row["health_status"], "bodyData": json_value(row["body_data"]),
    }


def get_active_plan(db, user_id: str):
    return db.execute(text("SELECT * FROM training_plan WHERE user_id=:uid AND status='active' ORDER BY version DESC LIMIT 1"), {"uid": user_id}).mappings().first()


def plan_payload(db, plan):
    if not plan:
        return None
    workouts = db.execute(text("""SELECT w.*, c.source_key, c.content AS course_content FROM workout w
      LEFT JOIN course_catalog c ON c.id=w.course_id WHERE w.plan_id=:pid ORDER BY w.week_no,w.day_no"""), {"pid": plan["id"]}).mappings().all()
    return {
        "id": plan["id"], "version": plan["version"], "status": plan["status"], "title": plan["title"],
        "goal": plan["goal"], "targetMinutes": float(plan["target_minutes"]) if plan["target_minutes"] is not None else None,
        "weeks": plan["weeks"], "trainDays": plan["train_days"], "summary": plan["summary"],
        "createdAt": plan["created_at"].isoformat(), "workouts": [{
            "id": w["id"], "week": w["week_no"], "day": w["day_no"], "type": w["type"], "title": w["title"],
            "durationMin": w["duration_min"], "distanceKm": float(w["distance_km"]) if w["distance_km"] is not None else None,
            "distanceRangeKm": workout_range_payload(w)[0], "paceRangeMinPerKm": workout_range_payload(w)[1],
            "intensity": w["intensity"], "talkTest": w["talk_test"], "purpose": w["purpose"],
            "prerequisite": w["prerequisite"], "downgradeRule": w["downgrade_rule"], "status": w["status"],
            "courseId": w["course_id"], "courseKey": w["source_key"], "courseName": w["title"],
            "courseContent": json_value(w["course_content"]) if w["course_content"] else None,
        } for w in workouts]
    }


@app.on_event("startup")
def startup():
    # Synchronize course identities from the Dify retrieval source. This only creates
    # catalog metadata; Dify remains the sole owner of plan/course selection.
    path = KNOWLEDGE_BASE_DIR / "10km计划首次生成知识库.md"
    if not path.is_file():
        return
    source = path.read_text(encoding="utf-8")
    sections = re.split(r"(?m)^###\s+", source)[1:]
    type_map = {"easy": "easy", "aerobic_base": "easy", "run_walk": "easy", "recovery": "recovery",
                "long_run": "long", "long": "long", "quality": "quality", "tempo": "tempo", "interval": "interval", "strides": "quality"}
    with Session.begin() as db:
        for section in sections:
            heading, _, body = section.partition("\n")
            attrs = dict(re.findall(r"([A-Za-z]+)=([^｜|]+)", heading))
            key, name = attrs.get("courseKey"), attrs.get("title")
            if not key or not name or attrs.get("type", "").split(",")[0] not in type_map:
                continue
            course_type = type_map[attrs["type"].split(",")[0]]
            course_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"zhicheng-course:{key}"))
            db.execute(text("""INSERT INTO course_catalog(id,source_key,name,type,level,content,is_active,synced_at)
              VALUES(:id,:key,:name,:type,:level,:content,TRUE,UTC_TIMESTAMP(3))
              ON DUPLICATE KEY UPDATE name=VALUES(name),type=VALUES(type),level=VALUES(level),content=VALUES(content),is_active=TRUE,synced_at=VALUES(synced_at)"""), {
                "id": course_id, "key": key, "name": name, "type": course_type, "level": attrs.get("level"),
                "content": json.dumps({"title": name, "courseKey": key, "metadata": attrs, "body": body.strip()}, ensure_ascii=False),
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
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
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


def initial_retrieval_query(profile: dict, courses: list[dict]) -> str:
    # Retrieval tags are routing metadata required by the PRD; Dify owns all course selection and scheduling.
    body = profile.get("bodyData") or {}
    level = str(body.get("level") or "L1")
    phase = str(body.get("phase") or "base")
    if level not in {"L0", "L1", "L2", "L3"}: level = "L1"
    if phase not in {"base", "build", "peak", "taper"}: phase = "base"
    types = "run_walk,easy,aerobic_base,recovery,long_run" if level in {"L0", "L1"} else "easy,aerobic_base,recovery,long_run,tempo,interval"
    quality = "false" if level in {"L0", "L1"} else "true"
    allowed = "；".join(f"{row['source_key']}｜{row['name']}｜type={row['type']}｜level={row['level'] or 'L0-L3'}" for row in courses)
    return (f"goal=10km; level={level}; phase={phase}; train_days={profile['trainDays']}; type={types}; "
            f"quality={quality}; recovery=true; health_status={profile.get('healthStatus') or '未提供'}; "
            f"允许的知识库课程身份清单（courseKey｜title｜标准type｜level）：{allowed}。"
            "每条训练必须从清单选择真实课程身份；courseKey和title必须逐字照抄同一条目，type须与标准type一致。"
            "title只填写清单中的课程名，不要把courseKey拼入title；课程编号和课程名由不同字段分别提供。"
            "知识库检索结果用于决定课程结构、时长和规则，不得把文档ID、文件名、知识库名称当作课程ID或课程名。")


def plan_from_dify(db, user_id: str, profile: dict):
    body_data = {**(profile.get("bodyData") or {}), "height_cm": profile["height"], "weight_kg": profile["weight"]}
    course_catalog = db.execute(text("SELECT source_key,name,type,level FROM course_catalog WHERE is_active=TRUE ORDER BY source_key")).mappings().all()
    outputs = dify_workflow(DIFY_PLAN_API_KEY, "首次计划生成", {
        "goal": "完成10公里", "longest_run_km": str(profile["longestRunKm"]),
        "latest_10k_minutes": str(profile.get("latest10kMinutes") or ""), "train_days": str(profile["trainDays"]),
        "target_minutes": str(profile.get("targetMinutes") or ""), "health_status": profile.get("healthStatus") or "未提供",
        "retrieval_query": initial_retrieval_query(profile, course_catalog), "body_data": json.dumps(body_data, ensure_ascii=False),
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
    type_map = {"easy":"easy", "aerobic_base":"easy", "run_walk":"easy", "recovery":"recovery", "long":"long", "long_run":"long", "quality":"quality", "strides":"quality", "tempo":"tempo", "interval":"interval", "rest":"rest", "other":"other"}
    for item in workouts:
        if not isinstance(item, dict): raise HTTPException(status_code=502, detail="Dify 计划包含无效训练条目")
        try:
            week, day = int(item.get("week", 0)), int(item.get("day", 0))
        except (TypeError, ValueError):
            raise HTTPException(status_code=502, detail="Dify 计划训练日期格式错误")
        workout_type = type_map.get(str(item.get("type") or "").lower())
        duration, distance = item.get("durationMin"), item.get("distanceKm")
        course_key, course_name = str(item.get("courseKey") or "").strip(), str(item.get("title") or "").strip()
        catalog = db.execute(text("SELECT id,name,type FROM course_catalog WHERE source_key=:key AND is_active=TRUE"), {"key": course_key}).mappings().first()
        # Dify sometimes repeats the courseKey in the title. Accept only this exact
        # redundant prefix, then persist the canonical name from course_catalog.
        if catalog and course_name == f"{course_key} {catalog['name']}":
            course_name = catalog["name"]
        if not (1 <= week <= weeks and 1 <= day <= 7 and (duration or distance) and item.get("intensity") and workout_type
                and catalog and course_name == catalog["name"]):
            raise HTTPException(status_code=502, detail="Dify 计划课程必须包含知识库中的有效 courseKey 和准确课程名")
        if catalog["type"] != workout_type:
            raise HTTPException(status_code=502, detail="Dify 计划课程类型与知识库课程不一致")
        distance_min, distance_max, pace_range = workout_range_values(item, required=True)
        ranges_by_position[(week, day)] = (distance_min, distance_max, pace_range)
        normalized.append((week, day, workout_type))
    if len({(week, day) for week, day, _ in normalized}) != len(normalized):
        raise HTTPException(status_code=502, detail="Dify 计划重复安排了同一训练日期")
    quality_slots = {(w, day) for w, day, kind in normalized if kind in {"quality", "tempo", "interval"}}
    for week in range(1, weeks + 1):
        rows = sorted((day, kind) for w, day, kind in normalized if w == week)
        if len(rows) > days or not any(kind in {"easy", "recovery"} for _, kind in rows):
            raise HTTPException(status_code=502, detail="Dify 计划不符合每周训练次数或轻松/恢复课约束")
        if sum(kind in {"quality", "tempo", "interval"} for _, kind in rows) > 2:
            raise HTTPException(status_code=502, detail="Dify 计划每周质量课超过 2 次")
        if any(kind == "interval" for _, kind in rows) and (profile.get("bodyData") or {}).get("level", "L1") in {"L0", "L1"}:
            raise HTTPException(status_code=502, detail="Dify 为 L0-L1 用户安排了间歇课")
        for day, kind in rows:
            if kind == "long":
                adjacent = {(week, day - 1), (week, day + 1)}
                if day == 1: adjacent.add((week - 1, 7))
                if day == 7: adjacent.add((week + 1, 1))
                if adjacent & quality_slots:
                    raise HTTPException(status_code=502, detail="Dify 长距离课与质量课相邻")
    existing = get_active_plan(db, user_id)
    version = int(existing["version"]) + 1 if existing else 1
    if existing:
        db.execute(text("UPDATE training_plan SET status='superseded',superseded_at=UTC_TIMESTAMP(3) WHERE id=:id"), {"id": existing["id"]})
    plan_id = uid()
    db.execute(text("""INSERT INTO training_plan(id,user_id,version,status,title,goal,target_minutes,weeks,train_days,source,summary,profile_snapshot)
      VALUES(:id,:uid,:version,'active',:title,'complete_10k',:target,:weeks,:days,'dify',:summary,:snapshot)"""), {
        "id": plan_id, "uid": user_id, "version": version, "title": str(result.get("title") or "10km训练计划")[:160],
        "target": result.get("targetMinutes", profile.get("targetMinutes")), "weeks": weeks, "days": days,
        "summary": str(result.get("summary") or "由 Dify 首次计划工作流生成。"),
        "snapshot": json.dumps(profile, ensure_ascii=False),
    })
    for item in workouts:
        week, day = int(item["week"]), int(item["day"])
        duration, distance = item.get("durationMin"), item.get("distanceKm")
        workout_type = type_map[str(item["type"]).lower()]
        distance_min, distance_max, pace_range = ranges_by_position[(week, day)]
        db.execute(text("""INSERT INTO workout(id,plan_id,course_id,week_no,day_no,type,title,duration_min,distance_km,distance_min_km,distance_max_km,pace_range_min_per_km,intensity,talk_test,purpose,prerequisite,downgrade_rule,status)
          VALUES(:id,:plan,:course,:week,:day,:type,:title,:duration,:distance,:distance_min,:distance_max,:pace,:intensity,:talk,:purpose,:prerequisite,:down,'scheduled')"""), {
            "id": uid(), "plan": plan_id, "course": db.execute(text("SELECT id FROM course_catalog WHERE source_key=:key"), {"key": item["courseKey"]}).scalar_one(), "week": week, "day": day, "type": workout_type,
            "title": str(item["title"])[:160], "duration": duration, "distance": distance, "distance_min": distance_min,
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
    body = {**payload.bodyData, "health": payload.health}
    health_status = payload.healthStatus or "、".join(payload.health)
    with Session.begin() as db:
        db.execute(text("""INSERT INTO runner_profile(user_id,height_cm,weight_kg,goal,longest_run_km,latest_10k_minutes,train_days,target_minutes,health_status,body_data)
          VALUES(:uid,:height,:weight,'complete_10k',:longest,:latest,:days,:target,:health,:body)
          ON DUPLICATE KEY UPDATE height_cm=VALUES(height_cm),weight_kg=VALUES(weight_kg),goal=VALUES(goal),longest_run_km=VALUES(longest_run_km),latest_10k_minutes=VALUES(latest_10k_minutes),train_days=VALUES(train_days),target_minutes=VALUES(target_minutes),health_status=VALUES(health_status),body_data=VALUES(body_data)"""), {
            "uid": user["id"], "height": payload.height, "weight": payload.weight, "longest": payload.longestRunKm,
            "latest": payload.latest10kMinutes, "days": payload.trainDays, "target": payload.targetMinutes,
            "health": health_status, "body": json.dumps(body, ensure_ascii=False),
        })
    return {"profile": payload.model_dump()}


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
    adjustment_items = ai_result.get("workouts", [])
    if not adjustment_items and ai_result.get("status") in {"rest", "medical_review"}:
        # Some published Dify runs place explicit rest/cancellation entries in
        # planChanges while leaving workouts empty. Treat those entries as the
        # actual, scope-checked workout changes.
        adjustment_items = ai_result.get("planChanges", [])
    for item in adjustment_items:
        row = db.execute(text("SELECT id,type FROM workout WHERE plan_id=:pid AND week_no=:week AND day_no=:day AND status='scheduled'"), {
            "pid": new_id, "week": int(item["week"]), "day": int(item["day"]),
        }).mappings().first()
        if not row:
            raise HTTPException(status_code=502, detail="Dify 调整返回了不存在或已完成的训练日期")
        cancel_for_rest = (
            ai_result.get("status") in {"rest", "medical_review"}
            and item.get("durationMin") in (0, 0.0, "0")
            and item.get("distanceKm") in (None, 0, 0.0, "0")
        )
        raw_type = str(item.get("type") or row["type"]).lower()
        typ = {"easy":"easy", "aerobic_base":"easy", "run_walk":"easy", "recovery":"recovery", "long":"long", "long_run":"long", "quality":"quality", "strides":"quality", "tempo":"tempo", "interval":"interval", "rest":"rest", "other":"other"}.get(raw_type)
        if not typ:
            raise HTTPException(status_code=502, detail="Dify 调整返回了不支持的课程类型")
        if not cancel_for_rest and not (item.get("durationMin") or item.get("distanceKm")):
            raise HTTPException(status_code=502, detail="Dify 调整训练缺少时长或距离")
        course_key = str(item.get("courseKey") or "").strip()
        course_name = str(item.get("title") or "").strip()
        catalog = db.execute(text("SELECT id,name,type,content FROM course_catalog WHERE source_key=:key AND is_active=TRUE"), {"key": course_key}).mappings().first()
        if not catalog or catalog["name"] != course_name or catalog["type"] != typ:
            raise HTTPException(status_code=502, detail="Dify 调整课程必须匹配知识库中的 courseKey、课程名和课程类型")
        if cancel_for_rest:
            distance_min = distance_max = pace_range = None
        else:
            distance_min, distance_max, pace_range = workout_range_values(item, catalog["content"], required=False)
        db.execute(text("""UPDATE workout SET course_id=:course,type=:type,title=:title,duration_min=:duration,distance_km=:distance,
          distance_min_km=:distance_min,distance_max_km=:distance_max,pace_range_min_per_km=:pace,
          intensity=:intensity,talk_test=:talk,purpose=:purpose,downgrade_rule=:down,status=:status WHERE id=:id"""), {
            "id": row["id"], "course": catalog["id"], "title": catalog["name"], "type": typ, "duration": 0 if cancel_for_rest else item.get("durationMin"), "distance": None if cancel_for_rest else item.get("distanceKm"),
            "distance_min": distance_min, "distance_max": distance_max, "pace": pace_range,
            "intensity": "休息" if cancel_for_rest else str(item.get("intensity") or "")[:120], "talk": str(item.get("talkTest") or ""),
            "purpose": str(item.get("note") or item.get("purpose") or ""), "down": str(item.get("downgradeRule") or ""),
            "status": "skipped" if cancel_for_rest else "scheduled",
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
        previous_run = db.execute(text("SELECT related_plan_id,response_summary FROM ai_workflow_run WHERE user_id=:uid AND workflow_type='plan_adjust' AND idempotency_key=:key AND status='succeeded'"), {"uid": user["id"], "key": record_id}).first()
        if previous_run and previous_run[0]:
            plan = db.execute(text("SELECT * FROM training_plan WHERE id=:id"), {"id": previous_run[0]}).mappings().first()
            cached_outputs = json_value(previous_run[1]) or {}
            cached_adjustment = json_value(row["analysis_result"]) or {}
            feedback_analysis = cached_adjustment.get("feedback_analysis") or ""
            return {"plan": plan_payload(db, plan), "adjustment": cached_adjustment or None, "feedbackAnalysis": str(feedback_analysis), "warmupStretchSources": cached_outputs.get("warmup_stretch_sources", [])}
        active = get_active_plan(db, user["id"])
        if not active:
            raise HTTPException(status_code=409, detail="当前没有可调整的计划")
        current_plan = plan_payload(db, active)
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
            "pain": row["pain"], "discomfort": bool(row["discomfort"]),
            "discomfortParts": json_value(row["discomfort_parts"]), "note": row["note"],
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
        feedback_analysis = str(ai_result.get("feedback_analysis") or "")
        valid_status = {"maintain","progress","reduce","recovery","rest","medical_review"}
        valid_scope = {"none","next_1","next_2","next_3","current_week"}
        if (ai_result.get("status") not in valid_status or ai_result.get("adjustmentScope") not in valid_scope
                or not isinstance(ai_result.get("workouts"), list) or not isinstance(ai_result.get("planChanges"), list)):
            raise HTTPException(status_code=502, detail="Dify 训练调整输出字段不完整")
        scope = ai_result["adjustmentScope"]
        target_rows = current_plan["adjustmentTargets"].get(scope, [])
        target_days = {(int(item["week"]), int(item["day"])) for item in target_rows}
        adjustment_items = ai_result["workouts"]
        if not adjustment_items and ai_result["status"] in {"rest", "medical_review"}:
            adjustment_items = ai_result["planChanges"]
        def is_in_scope(item):
            try:
                return isinstance(item, dict) and (int(item.get("week", 0)), int(item.get("day", 0))) in target_days
            except (TypeError, ValueError):
                return False
        if any(not is_in_scope(item) for item in adjustment_items):
            raise HTTPException(status_code=502, detail="Dify 调整课程超出了反馈分析指定的训练范围")
        if ai_result["status"] not in {"maintain", "rest"} and scope != "none" and not adjustment_items:
            raise HTTPException(status_code=502, detail="Dify 调整状态要求变更课程，但未返回受影响训练")
        for item in adjustment_items:
            if not isinstance(item, dict):
                raise HTTPException(status_code=502, detail="Dify 训练调整包含无效训练条目")
            try:
                week, day = int(item["week"]), int(item["day"])
            except (KeyError, TypeError, ValueError):
                raise HTTPException(status_code=502, detail="Dify 调整训练缺少有效 week/day")
            cancel_for_rest = (
                ai_result.get("status") in {"rest", "medical_review"}
                and item.get("durationMin") in (0, 0.0, "0")
                and item.get("distanceKm") in (None, 0, 0.0, "0")
            )
            has_positive_target = bool(item.get("durationMin") or item.get("distanceKm"))
            if not (1 <= week <= int(active["weeks"]) and 1 <= day <= 7 and item.get("type") and item.get("intensity")
                    and (has_positive_target or cancel_for_rest)):
                raise HTTPException(status_code=502, detail="Dify 调整训练条目缺少课程类型、目标或强度")
        plan = clone_plan_with_dify_adjustment(db, user["id"], active, ai_result)
        adjustment = ai_result
        db.execute(text("UPDATE training_feedback SET analysis_result=:analysis WHERE id=:id"), {
            "id": row["id"], "analysis": json.dumps(adjustment, ensure_ascii=False),
        })
        feedback_id = row["id"]
        db.execute(text("""INSERT INTO ai_workflow_run(id,user_id,workflow_type,idempotency_key,status,request_summary,response_summary,validation_result,related_plan_id,related_feedback_id,finished_at)
          VALUES(:id,:uid,'plan_adjust',:key,'succeeded',:request,:response,:validation,:plan,:feedback,UTC_TIMESTAMP(3))"""), {
            "id": uid(), "uid": user["id"], "key": record_id, "request": json.dumps(feedback, ensure_ascii=False),
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
