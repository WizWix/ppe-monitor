from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database import get_db
from backend.models import AlertRule, User
from backend.auth import get_current_user, require_role
from backend.schemas import AlertRuleCreate, AlertRuleOut

router = APIRouter(prefix="/api/alert-rules", tags=["alert_rules"])


@router.get("", response_model=list[AlertRuleOut])
async def list_rules(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(AlertRule).order_by(AlertRule.id))
    return result.scalars().all()


@router.post("", response_model=AlertRuleOut, status_code=201)
async def create_rule(
    body: AlertRuleCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("site_manager", "admin")),
):
    rule = AlertRule(**body.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=AlertRuleOut)
async def update_rule(
    rule_id: int,
    body: AlertRuleCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("site_manager", "admin")),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for field, value in body.model_dump().items():
        setattr(rule, field, value)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("site_manager", "admin")),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    await db.commit()
