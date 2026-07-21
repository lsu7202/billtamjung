"""크레딧: 잔액(버킷)·원장. specs S0M §3.2."""
from fastapi import APIRouter, Depends
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/credits", tags=["credits"])


@router.get("")
async def balance(user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        "SELECT bucket, amount FROM app.credit_balances WHERE account_id=$1", user.account_id
    )
    by = {r["bucket"]: r["amount"] for r in rows}
    return {
        "total": sum(by.values()),
        "monthly": by.get("monthly", 0),
        "earned": by.get("earned", 0),
        "purchased": by.get("purchased", 0),
    }


@router.get("/entries")
async def entries(user: CurrentUser = Depends(current_user), limit: int = 50):
    rows = await pool().fetch(
        """SELECT occurred_at, type, bucket, amount, reason, ref_id
           FROM app.credit_entries WHERE account_id=$1
           ORDER BY occurred_at DESC LIMIT $2""",
        user.account_id, limit,
    )
    return [dict(r) for r in rows]
